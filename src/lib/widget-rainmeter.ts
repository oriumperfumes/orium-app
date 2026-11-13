/**
 * Widget no DESKTOP do Windows (em cima do papel de parede, junto dos atalhos)
 * via Rainmeter — programa gratuito feito exatamente para isso.
 *
 * Gera no navegador um pacote .rmskin (zip + rodapé do Rainmeter) com dois
 * widgets da Orium — "Pedidos" (médio) e "Foco" (pequeno) — já com a chave do
 * computador. Duplo clique no arquivo instala. Os dados vêm de
 * /api/public/widget?format=text (campos separados por "|").
 */

const GOLD = "255,213,153";

function pedidosIni() {
  const rows = [0, 1, 2]
    .map((i) => {
      const y = 46 + i * 40;
      const b = 9 + i * 4; // índice do primeiro campo da linha
      return `
[MeasureWhen${i}]
Measure=WebParser
URL=[MeasureData]
StringIndex=${b}

[MeasureName${i}]
Measure=WebParser
URL=[MeasureData]
StringIndex=${b + 1}

[MeasureWhenColor${i}]
Measure=WebParser
URL=[MeasureData]
StringIndex=${b + 2}

[MeasurePhaseColor${i}]
Measure=WebParser
URL=[MeasureData]
StringIndex=${b + 3}

[MeterRow${i}]
Meter=Shape
Shape=Rectangle 14,${y},332,34,10 | Fill Color 255,255,255,13 | StrokeWidth 0

[MeterWhen${i}]
Meter=String
MeasureName=MeasureWhen${i}
X=26
Y=${y + 9}
W=74
ClipString=1
FontFace=Segoe UI
FontSize=9
StringStyle=Bold
FontColor=[MeasureWhenColor${i}]
DynamicVariables=1
AntiAlias=1

[MeterName${i}]
Meter=String
MeasureName=MeasureName${i}
X=104
Y=${y + 7}
W=210
ClipString=1
FontFace=Segoe UI
FontSize=10
StringStyle=Bold
FontColor=255,255,255
AntiAlias=1

[MeterPhase${i}]
Meter=String
Text=●
X=326
Y=${y + 8}
FontSize=9
FontColor=[MeasurePhaseColor${i}]
DynamicVariables=1
AntiAlias=1
`;
    })
    .join("");

  return `[Rainmeter]
Update=1000
AccurateText=1
LeftMouseUpAction=["#Admin#"]

[Metadata]
Name=Orium · Pedidos
Author=Orium Perfumes
Information=Próximas entregas da Orium. Atualiza a cada 5 minutos. Clique para abrir os pedidos.

[Variables]
@Include=#@#Variables.inc

[MeasureData]
Measure=WebParser
URL=#Endpoint#?format=text&key=#Key#
UpdateRate=300
CodePage=65001
RegExp=(?siU)^(.*)\\|(.*)\\|(.*)\\|(.*)\\|(.*)\\|(.*)\\|(.*)\\|(.*)\\|(.*)\\|(.*)\\|(.*)\\|(.*)\\|(.*)\\|(.*)\\|(.*)\\|(.*)\\|(.*)\\|(.*)\\|(.*)\\|(.*)$
FinishAction=[!UpdateMeter *][!Redraw]

[MeasureTitle]
Measure=WebParser
URL=[MeasureData]
StringIndex=2

[MeasureTone]
Measure=WebParser
URL=[MeasureData]
StringIndex=4

[MeasureReceivable]
Measure=WebParser
URL=[MeasureData]
StringIndex=8

[MeterBg]
Meter=Shape
Shape=Rectangle 0,0,360,200,24 | Fill Color 20,20,20,242 | StrokeWidth 1 | Stroke Color 255,255,255,18

[MeterDot]
Meter=String
Text=●
X=16
Y=15
FontSize=8
FontColor=[MeasureTone]
DynamicVariables=1
AntiAlias=1

[MeterTitle]
Meter=String
MeasureName=MeasureTitle
X=32
Y=12
W=250
ClipString=1
FontFace=Segoe UI
FontSize=11
StringStyle=Bold
FontColor=255,255,255
AntiAlias=1

[MeterMark]
Meter=String
Text=ORIUM
X=344
Y=15
StringAlign=Right
FontFace=Segoe UI
FontSize=7
StringStyle=Bold
FontColor=255,255,255,90
AntiAlias=1
${rows}
[MeterReceivable]
Meter=String
MeasureName=MeasureReceivable
Text=A receber %1
X=16
Y=174
FontFace=Segoe UI
FontSize=8
FontColor=${GOLD}
AntiAlias=1
`;
}

function focoIni() {
  return `[Rainmeter]
Update=1000
AccurateText=1
LeftMouseUpAction=["#Admin#"]

[Metadata]
Name=Orium · Foco
Author=Orium Perfumes
Information=Quantos pedidos para entregar hoje, amanhã ou no próximo dia.

[Variables]
@Include=#@#Variables.inc

[MeasureData]
Measure=WebParser
URL=#Endpoint#?format=text&key=#Key#
UpdateRate=300
CodePage=65001
RegExp=(?siU)^(.*)\\|(.*)\\|(.*)\\|(.*)\\|(.*)\\|(.*)\\|(.*)\\|(.*)\\|
FinishAction=[!UpdateMeter *][!Redraw]

[MeasureLabel]
Measure=WebParser
URL=[MeasureData]
StringIndex=1

[MeasureSub]
Measure=WebParser
URL=[MeasureData]
StringIndex=3

[MeasureTone]
Measure=WebParser
URL=[MeasureData]
StringIndex=4

[MeasureCount]
Measure=WebParser
URL=[MeasureData]
StringIndex=5

[MeasureCaption]
Measure=WebParser
URL=[MeasureData]
StringIndex=6

[MeasureRatio]
Measure=WebParser
URL=[MeasureData]
StringIndex=7

[MeterBg]
Meter=Shape
Shape=Rectangle 0,0,180,180,24 | Fill Color 20,20,20,242 | StrokeWidth 1 | Stroke Color 255,255,255,18

[MeterDot]
Meter=String
Text=●
X=16
Y=15
FontSize=8
FontColor=[MeasureTone]
DynamicVariables=1
AntiAlias=1

[MeterLabel]
Meter=String
MeasureName=MeasureLabel
X=32
Y=12
FontFace=Segoe UI
FontSize=10
StringStyle=Bold
FontColor=255,255,255
AntiAlias=1

[MeterRatio]
Meter=String
MeasureName=MeasureRatio
X=164
Y=14
StringAlign=Right
FontFace=Segoe UI
FontSize=8
StringStyle=Bold
FontColor=${GOLD}
AntiAlias=1

[MeterCount]
Meter=String
MeasureName=MeasureCount
X=14
Y=58
FontFace=Segoe UI Semibold
FontSize=40
FontColor=255,255,255
AntiAlias=1

[MeterCaption]
Meter=String
MeasureName=MeasureCaption
X=16
Y=126
W=150
ClipString=1
FontFace=Segoe UI
FontSize=9
StringStyle=Bold
FontColor=255,255,255
AntiAlias=1

[MeterSub]
Meter=String
MeasureName=MeasureSub
X=16
Y=146
W=150
ClipString=1
FontFace=Segoe UI
FontSize=8
FontColor=255,255,255,130
AntiAlias=1
`;
}

/* ─────────────── zip (sem compressão) + rodapé .rmskin ─────────────── */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** Rainmeter lê .ini com acentos/símbolos em UTF-16 LE com BOM. */
function utf16(text: string) {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[2 + i * 2] = c & 0xff;
    out[3 + i * 2] = c >> 8;
  }
  return out;
}

function zip(files: Array<{ name: string; data: Uint8Array }>) {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true); // nomes em UTF-8
    v.setUint16(8, 0, true); // sem compressão
    v.setUint32(14, crc, true);
    v.setUint32(18, f.data.length, true);
    v.setUint32(22, f.data.length, true);
    v.setUint16(26, name.length, true);
    local.set(name, 30);
    chunks.push(local, f.data);
    const cen = new Uint8Array(46 + name.length);
    const w = new DataView(cen.buffer);
    w.setUint32(0, 0x02014b50, true);
    w.setUint16(4, 20, true);
    w.setUint16(6, 20, true);
    w.setUint16(8, 0x0800, true);
    w.setUint32(16, crc, true);
    w.setUint32(20, f.data.length, true);
    w.setUint32(24, f.data.length, true);
    w.setUint16(28, name.length, true);
    w.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);
    offset += local.length + f.data.length;
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, cenSize, true);
  e.setUint32(16, offset, true);
  const all = [...chunks, ...central, end];
  const size = all.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(size);
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/** Pacote .rmskin: zip + 16 bytes (tamanho do zip, flags, "RMSKIN\0"). */
export function rainmeterPackage({ endpoint, key, adminUrl }: { endpoint: string; key: string; adminUrl: string }) {
  const enc = new TextEncoder();
  const z = zip([
    {
      name: "RMSKIN.ini",
      data: enc.encode(
        "[rmskin]\r\nName=Orium\r\nAuthor=Orium Perfumes\r\nVersion=1.0\r\nMinimumRainmeter=4.5.0\r\nMinimumWindows=10.0\r\nLoadType=Skin\r\nLoad=Orium\\Pedidos\\Pedidos.ini\r\n",
      ),
    },
    { name: "Skins/Orium/@Resources/Variables.inc", data: enc.encode(`[Variables]\r\nEndpoint=${endpoint}\r\nKey=${key}\r\nAdmin=${adminUrl}\r\n`) },
    { name: "Skins/Orium/Pedidos/Pedidos.ini", data: utf16(pedidosIni().replace(/\n/g, "\r\n")) },
    { name: "Skins/Orium/Foco/Foco.ini", data: utf16(focoIni().replace(/\n/g, "\r\n")) },
  ]);
  const footer = new Uint8Array(16);
  const f = new DataView(footer.buffer);
  f.setUint32(0, z.length, true); // tamanho do zip (64 bits, parte baixa)
  f.setUint32(4, 0, true);
  footer[8] = 0; // flags
  footer.set(enc.encode("RMSKIN"), 9);
  footer[15] = 0;
  const out = new Uint8Array(z.length + 16);
  out.set(z, 0);
  out.set(footer, z.length);
  return out;
}
