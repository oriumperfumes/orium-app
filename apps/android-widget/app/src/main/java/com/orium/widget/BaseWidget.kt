package com.orium.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import org.json.JSONObject
import kotlin.concurrent.thread

/** Busca os dados fora da thread principal e desenha cada widget. */
abstract class BaseWidget : AppWidgetProvider() {
    abstract val layout: Int
    abstract fun draw(ctx: Context, views: RemoteViews, s: JSONObject)
    abstract fun drawError(ctx: Context, views: RemoteViews, msg: String)

    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        val pending = goAsync()
        thread {
            try {
                val res = Orium.load(ctx)
                ids.forEach { id ->
                    val views = RemoteViews(ctx.packageName, layout)
                    views.setOnClickPendingIntent(R.id.root, Orium.openAdmin(ctx))
                    res.fold({ draw(ctx, views, it) }, { drawError(ctx, views, it.message ?: "Sem conexão") })
                    mgr.updateAppWidget(id, views)
                }
            } finally {
                pending.finish()
            }
        }
    }

    override fun onReceive(ctx: Context, intent: Intent) {
        super.onReceive(ctx, intent)
        if (intent.action == Orium.REFRESH) {
            val mgr = AppWidgetManager.getInstance(ctx)
            onUpdate(ctx, mgr, mgr.getAppWidgetIds(ComponentName(ctx, javaClass)))
        }
    }
}

class FocoWidget : BaseWidget() {
    override val layout = R.layout.foco_small
    override fun draw(ctx: Context, views: RemoteViews, s: JSONObject) {
        val focus = s.optString("focus")
        val count = s.optInt("focusCount").takeIf { it > 0 } ?: s.optJSONObject("counts")?.optInt("open") ?: 0
        views.setTextColor(R.id.dot, Orium.tone(s.optString("tone")))
        views.setTextViewText(R.id.label, Orium.focusLabel(s))
        views.setTextViewText(R.id.count, count.toString())
        views.setTextViewText(R.id.caption, if (focus == "none") "pedidos em andamento" else if (count == 1) "pedido para entregar" else "pedidos para entregar")
        views.setTextViewText(R.id.sub, s.optString("sub"))
        // prontos / total do foco
        val groups = when (focus) { "today" -> setOf("late", "today"); "tomorrow" -> setOf("tomorrow"); else -> emptySet() }
        val next = s.optJSONArray("next")
        var total = 0
        var ready = 0
        if (next != null) for (i in 0 until next.length()) {
            val o = next.getJSONObject(i)
            if (o.optString("group") in groups) { total++; if (o.optString("phase") == "entregar") ready++ }
        }
        views.setTextViewText(R.id.ratio, if (total > 0) "$ready/$total prontos" else "")
    }
    override fun drawError(ctx: Context, views: RemoteViews, msg: String) {
        views.setTextViewText(R.id.label, "Orium")
        views.setTextViewText(R.id.count, "–")
        views.setTextViewText(R.id.caption, "Sem dados")
        views.setTextViewText(R.id.sub, msg)
    }
}

class ProximasWidget : BaseWidget() {
    override val layout = R.layout.proximas_medium
    private val rows = listOf(
        intArrayOf(R.id.row1, R.id.when1, R.id.name1, R.id.pdot1),
        intArrayOf(R.id.row2, R.id.when2, R.id.name2, R.id.pdot2),
        intArrayOf(R.id.row3, R.id.when3, R.id.name3, R.id.pdot3),
    )
    override fun draw(ctx: Context, views: RemoteViews, s: JSONObject) {
        views.setTextColor(R.id.dot, Orium.tone(s.optString("tone")))
        views.setTextViewText(R.id.title, s.optString("title"))
        val next = s.optJSONArray("next")
        val n = next?.length() ?: 0
        views.setViewVisibility(R.id.empty, if (n == 0) android.view.View.VISIBLE else android.view.View.GONE)
        rows.forEachIndexed { i, ids ->
            if (i < n) {
                val o = next!!.getJSONObject(i)
                views.setViewVisibility(ids[0], android.view.View.VISIBLE)
                views.setTextViewText(ids[1], o.optString("short", o.optString("when")))
                views.setTextColor(ids[1], Orium.groupColor(o.optString("group")))
                views.setTextViewText(ids[2], o.optString("name"))
                views.setTextColor(ids[3], Orium.phaseColor(o.optString("phase")))
            } else views.setViewVisibility(ids[0], android.view.View.GONE)
        }
    }
    override fun drawError(ctx: Context, views: RemoteViews, msg: String) {
        views.setTextViewText(R.id.title, msg)
        rows.forEach { views.setViewVisibility(it[0], android.view.View.GONE) }
    }
}

class SemanaWidget : BaseWidget() {
    override val layout = R.layout.semana_medium
    private val l = intArrayOf(R.id.l0, R.id.l1, R.id.l2, R.id.l3, R.id.l4, R.id.l5, R.id.l6)
    private val d = intArrayOf(R.id.d0, R.id.d1, R.id.d2, R.id.d3, R.id.d4, R.id.d5, R.id.d6)
    private val c = intArrayOf(R.id.c0, R.id.c1, R.id.c2, R.id.c3, R.id.c4, R.id.c5, R.id.c6)
    override fun draw(ctx: Context, views: RemoteViews, s: JSONObject) {
        val week = s.optJSONArray("week") ?: return
        var total = 0
        for (i in 0 until minOf(7, week.length())) {
            val day = week.getJSONObject(i)
            val count = day.optInt("count")
            total += count
            views.setTextViewText(l[i], day.optString("label"))
            views.setTextColor(l[i], if (i == 0) Orium.WHITE else Orium.DIM)
            views.setTextViewText(d[i], day.optString("day"))
            views.setTextColor(d[i], if (count > 0) android.graphics.Color.parseColor("#15130F") else android.graphics.Color.parseColor("#66FFFFFF"))
            val bg = when {
                i == 0 && count > 0 -> R.drawable.circle_today_gold
                i == 0 -> R.drawable.circle_today_empty
                count > 0 -> R.drawable.circle_gold
                else -> R.drawable.circle_empty
            }
            views.setInt(d[i], "setBackgroundResource", bg)
            views.setTextViewText(c[i], if (count > 0) count.toString() else " ")
        }
        views.setTextViewText(R.id.title, "$total entregas nos próximos 7 dias")
    }
    override fun drawError(ctx: Context, views: RemoteViews, msg: String) {
        views.setTextViewText(R.id.title, msg)
    }
}
