package com.orium.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.widget.RemoteViews
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Orium Widgets — lê o resumo dos pedidos (/api/public/widget) com a chave do
 * aparelho (gerada em Admin → Widgets) e desenha os 3 widgets.
 * Sem login e sem dados sensíveis: só primeiro nome, dia/horário e fase.
 */
object Orium {
    const val ENDPOINT = "https://oriumperfumes.com/api/public/widget"
    const val ADMIN = "https://oriumperfumes.com/admin/pedidos"
    const val REFRESH = "com.orium.widget.REFRESH"
    private const val PREFS = "orium"

    val GOLD = Color.parseColor("#FFD599")
    val RED = Color.parseColor("#FF8A75")
    val GREEN = Color.parseColor("#7FCF9F")
    val WHITE = Color.WHITE
    val DIM = Color.parseColor("#80FFFFFF")

    fun key(ctx: Context): String? = ctx.getSharedPreferences(PREFS, 0).getString("key", null)
    fun saveKey(ctx: Context, key: String?) = ctx.getSharedPreferences(PREFS, 0).edit().putString("key", key).apply()
    private fun cache(ctx: Context): String? = ctx.getSharedPreferences(PREFS, 0).getString("cache", null)
    private fun saveCache(ctx: Context, json: String) = ctx.getSharedPreferences(PREFS, 0).edit().putString("cache", json).apply()

    /** Busca o resumo (ou devolve o último que deu certo). Rodar fora da thread principal. */
    fun load(ctx: Context): Result<JSONObject> {
        val k = key(ctx) ?: return Result.failure(IllegalStateException("Abra o app Orium Widgets e cole a chave."))
        return try {
            val conn = URL("$ENDPOINT?agenda=1&key=" + URLEncoder.encode(k, "UTF-8")).openConnection() as HttpURLConnection
            conn.connectTimeout = 12000
            conn.readTimeout = 15000
            val code = conn.responseCode
            if (code == 401) return Result.failure(IllegalStateException("Chave desligada. Gere outra no Admin."))
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            saveCache(ctx, body)
            val json = JSONObject(body)
            // agenda: entregas, cobranças e compras no calendário do celular
            try { CalendarSync.sync(ctx, json.optJSONArray("agenda")) } catch (_: Exception) { }
            Result.success(json)
        } catch (e: Exception) {
            cache(ctx)?.let { Result.success(JSONObject(it)) } ?: Result.failure(e)
        }
    }

    fun tone(t: String?) = when (t) { "red" -> RED; "gold" -> GOLD; else -> GREEN }
    fun phaseColor(p: String?) = when (p) { "comprar" -> RED; "chegando" -> GOLD; "pagamento" -> Color.parseColor("#D4D4D4"); else -> WHITE }
    fun groupColor(g: String?) = when (g) { "late" -> RED; "today" -> GOLD; else -> DIM }
    fun focusLabel(s: JSONObject) = when (s.optString("focus")) { "today" -> "Hoje"; "tomorrow" -> "Amanhã"; "week" -> "Próxima entrega"; else -> "Tudo em dia" }

    fun openAdmin(ctx: Context): PendingIntent =
        PendingIntent.getActivity(ctx, 1, Intent(Intent.ACTION_VIEW, Uri.parse(ADMIN)), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    /** Atualiza todos os widgets da Orium (depois de salvar a chave, por exemplo). */
    fun refreshAll(ctx: Context) {
        val mgr = AppWidgetManager.getInstance(ctx)
        listOf(FocoWidget::class.java, ProximasWidget::class.java, SemanaWidget::class.java).forEach { cls ->
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, cls))
            if (ids.isNotEmpty()) {
                ctx.sendBroadcast(Intent(ctx, cls).setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE).putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids))
            }
        }
    }

    fun error(views: RemoteViews, titleId: Int, msg: String) {
        views.setTextViewText(titleId, msg)
    }
}
