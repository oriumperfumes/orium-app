/**
 * ROTA DE COMPRAS — endereços reais + roteamento rodoviário real (Google Routes).
 * Nada de linha reta: sem endereço ou sem resposta da API, a rota não é inventada.
 */
type Db = any;

const GATEWAY = "https://connector-gateway.lovable.dev/google_maps";

function keys() {
  const lovable = process.env["LOVABLE_API_KEY"];
  const maps = process.env["GOOGLE_MAPS_API_KEY"];
  if (!lovable || !maps) throw new Error("Google Maps não está conectado.");
  return { Authorization: `Bearer ${lovable}`, "X-Connection-Api-Key": maps };
}

async function mapsError(res: Response) {
  const body = await res.text().catch(() => "");
  if (res.status === 403) return new Error("O Google Maps recusou o pedido (403). Verifique a conexão do Google Maps.");
  return new Error(`Google Maps respondeu ${res.status}: ${body.slice(0, 160)}`);
}

export async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const res = await fetch(`${GATEWAY}/maps/api/geocode/json?region=br&address=${encodeURIComponent(address)}`, {
    headers: keys(),
  });
  if (!res.ok) throw await mapsError(res);
  const json = (await res.json()) as { results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }> };
  const loc = json.results?.[0]?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

export type RouteStop = { supplier_id: string | null; name: string; address: string; lat: number; lng: number };

export type PurchaseRoute = {
  ok: boolean;
  message: string | null;
  origin: RouteStop | null;
  stops: RouteStop[];
  return_to_origin: boolean;
  distance_km: number | null;
  duration_min: number | null;
  legs: Array<{ from: string; to: string; km: number; min: number }>;
  tolls: string | null;
  travel_cost: number | null;
  maps_url: string | null;
  missing: string[];
};

const place = (s: RouteStop) => `${s.lat},${s.lng}`;

export async function buildPurchaseRoute(
  db: Db,
  supplierIds: string[],
  opts: { originAddress?: string | null; returnToOrigin?: boolean | null } = {},
): Promise<PurchaseRoute> {
  const { data: settings } = await db.from("purchase_settings").select("*").maybeSingle();
  const empty: PurchaseRoute = {
    ok: false,
    message: null,
    origin: null,
    stops: [],
    return_to_origin: true,
    distance_km: null,
    duration_min: null,
    legs: [],
    tolls: null,
    travel_cost: null,
    maps_url: null,
    missing: [],
  };

  // origem
  let originAddress = opts.originAddress?.trim() || settings?.origin_address || null;
  if (!originAddress) {
    const { data: ship } = await db.from("shipping_settings").select("street, number, district, city, state, origin_cep").maybeSingle();
    if (ship?.street) originAddress = [ship.street, ship.number, ship.district, ship.city, ship.state, ship.origin_cep].filter(Boolean).join(", ");
  }
  if (!originAddress) return { ...empty, message: "Local de saída não configurado." };
  let oLat = settings?.origin_latitude as number | null;
  let oLng = settings?.origin_longitude as number | null;
  if (opts.originAddress || oLat == null || oLng == null) {
    const g = await geocode(originAddress);
    if (!g) return { ...empty, message: "Não encontrei o endereço de saída." };
    oLat = g.lat;
    oLng = g.lng;
    if (!opts.originAddress)
      await db.from("purchase_settings").update({ origin_address: originAddress, origin_latitude: oLat, origin_longitude: oLng }).eq("id", true);
  }
  const origin: RouteStop = { supplier_id: null, name: "Orium", address: originAddress, lat: oLat!, lng: oLng! };

  // fornecedores
  const { data: sups } = await db
    .from("suppliers")
    .select("id, name, pickup_address, latitude, longitude, allows_pickup")
    .in("id", supplierIds);
  const stops: RouteStop[] = [];
  const missing: string[] = [];
  for (const s of (sups ?? []) as any[]) {
    if (!s.pickup_address) {
      missing.push(s.name);
      continue;
    }
    let lat = s.latitude as number | null;
    let lng = s.longitude as number | null;
    if (lat == null || lng == null) {
      const g = await geocode(s.pickup_address);
      if (!g) {
        missing.push(s.name);
        continue;
      }
      lat = g.lat;
      lng = g.lng;
      await db.from("suppliers").update({ latitude: lat, longitude: lng }).eq("id", s.id);
    }
    stops.push({ supplier_id: s.id, name: s.name, address: s.pickup_address, lat, lng });
  }
  if (!stops.length)
    return { ...empty, origin, missing, message: missing.length ? `Endereço não configurado: ${missing.join(", ")}.` : "Nenhum fornecedor na rota." };

  const back = opts.returnToOrigin ?? settings?.return_to_origin ?? true;
  const destination = back ? origin : stops[stops.length - 1]!;
  const intermediates = back ? stops : stops.slice(0, -1);
  const ll = (s: RouteStop) => ({ location: { latLng: { latitude: s.lat, longitude: s.lng } } });

  const res = await fetch(`${GATEWAY}/routes/directions/v2:computeRoutes`, {
    method: "POST",
    headers: {
      ...keys(),
      "Content-Type": "application/json",
      "X-Goog-FieldMask":
        "routes.distanceMeters,routes.duration,routes.optimizedIntermediateWaypointIndex,routes.legs.distanceMeters,routes.legs.duration,routes.travelAdvisory.tollInfo",
    },
    body: JSON.stringify({
      origin: ll(origin),
      destination: ll(destination),
      intermediates: intermediates.map(ll),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      optimizeWaypointOrder: intermediates.length > 1,
      extraComputations: ["TOLLS"],
      languageCode: "pt-BR",
      units: "METRIC",
    }),
  });
  if (!res.ok) throw await mapsError(res);
  const json = (await res.json()) as any;
  const route = json.routes?.[0];
  if (!route) return { ...empty, origin, stops, missing, message: "O Google não encontrou uma rota de carro." };

  const order: number[] = route.optimizedIntermediateWaypointIndex?.length
    ? route.optimizedIntermediateWaypointIndex
    : intermediates.map((_, i) => i);
  const orderedMid = order.map((i) => intermediates[i]!);
  const ordered = back ? orderedMid : [...orderedMid, destination];
  const seq = [origin, ...ordered, ...(back ? [origin] : [])];
  const legs = ((route.legs ?? []) as any[]).map((l, i) => ({
    from: seq[i]?.name ?? "",
    to: seq[i + 1]?.name ?? "",
    km: Math.round((Number(l.distanceMeters ?? 0) / 1000) * 10) / 10,
    min: Math.round(Number(String(l.duration ?? "0s").replace("s", "")) / 60),
  }));
  const km = Math.round((Number(route.distanceMeters ?? 0) / 1000) * 10) / 10;
  const min = Math.round(Number(String(route.duration ?? "0s").replace("s", "")) / 60);

  const toll = route.travelAdvisory?.tollInfo?.estimatedPrice?.[0];
  const tolls = toll ? `${toll.currencyCode ?? "BRL"} ${Number(toll.units ?? 0) + Number(toll.nanos ?? 0) / 1e9}` : null;

  let costPerKm: number | null = settings?.cost_per_km != null ? Number(settings.cost_per_km) : null;
  if (costPerKm == null && settings?.fuel_km_per_liter && settings?.fuel_price)
    costPerKm = Number(settings.fuel_price) / Number(settings.fuel_km_per_liter);
  const travel_cost = costPerKm != null ? Math.round(km * costPerKm * 100) / 100 : null;

  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", place(origin));
  url.searchParams.set("destination", place(destination));
  if (orderedMid.length) url.searchParams.set("waypoints", orderedMid.map(place).join("|"));
  url.searchParams.set("travelmode", "driving");

  return {
    ok: true,
    message: missing.length ? `Sem endereço (fora da rota): ${missing.join(", ")}.` : null,
    origin,
    stops: ordered,
    return_to_origin: back,
    distance_km: km,
    duration_min: min,
    legs,
    tolls,
    travel_cost,
    maps_url: url.toString(),
    missing,
  };
}
