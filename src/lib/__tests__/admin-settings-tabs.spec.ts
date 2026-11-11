import { describe, expect, it } from "vitest";
import { parseSettingsSearch, SETTINGS_TABS } from "../admin-settings-tabs";

describe("Configurações — abas, links e regressões de navegação", () => {
  it("mantém apenas Entregas, Integrações e IA, sem aba de mero atalho", () => {
    expect(SETTINGS_TABS.map(t => t.id)).toEqual(["entregas", "integracoes", "ia"]);
    expect(new Set(SETTINGS_TABS.map(t => t.id)).size).toBe(SETTINGS_TABS.length);
  });

  it("preserva deep links para Entregas, Integrações e Copilot", () => {
    expect(parseSettingsSearch({ aba: "entregas" })).toEqual({ aba: "entregas" });
    expect(parseSettingsSearch({ aba: "integracoes" })).toEqual({ aba: "integracoes" });
    expect(parseSettingsSearch({ aba: "ia", secao: "copilot" })).toEqual({ aba: "ia", secao: "copilot" });
    expect(parseSettingsSearch({ secao: "copilot" })).toEqual({ aba: "ia", secao: "copilot" });
  });

  it("ignora valores inválidos sem redirecionar para outras telas", () => {
    expect(parseSettingsSearch({ aba: "seguranca", secao: "chave-secreta" })).toEqual({});
    expect(parseSettingsSearch({ aba: "__proto__", secao: 2 })).toEqual({});
    expect(parseSettingsSearch({ aba: "vendas", secao: "inexistente" })).toEqual({});
    expect(parseSettingsSearch({ aba: "entregas", secao: "copilot" })).toEqual({ aba: "entregas" });
  });
});
