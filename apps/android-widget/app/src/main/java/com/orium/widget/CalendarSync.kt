package com.orium.widget

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.provider.CalendarContract
import org.json.JSONArray
import java.util.Calendar
import java.util.TimeZone

/**
 * Grava a agenda da Orium no calendário do celular, numa agenda própria
 * "Orium · Pedidos" (aparece no Google Agenda / Calendário do Android com
 * cor dourada). Cada evento tem um código fixo (uid): se a data muda ele se
 * move, se o pedido foi entregue ele some. Lembretes iguais aos do iPhone.
 */
object CalendarSync {
    private const val ACCOUNT = "Orium"
    private const val NAME = "Orium · Pedidos"
    private const val TZ = "America/Sao_Paulo"

    fun hasPermission(ctx: Context) =
        ctx.checkSelfPermission(Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED &&
            ctx.checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED

    private fun asSync(uri: Uri): Uri = uri.buildUpon()
        .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
        .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME, ACCOUNT)
        .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
        .build()

    private fun calendarId(ctx: Context): Long {
        val cr = ctx.contentResolver
        cr.query(
            CalendarContract.Calendars.CONTENT_URI,
            arrayOf(CalendarContract.Calendars._ID),
            "${CalendarContract.Calendars.ACCOUNT_NAME}=? AND ${CalendarContract.Calendars.ACCOUNT_TYPE}=?",
            arrayOf(ACCOUNT, CalendarContract.ACCOUNT_TYPE_LOCAL),
            null,
        )?.use { if (it.moveToFirst()) return it.getLong(0) }
        val v = ContentValues().apply {
            put(CalendarContract.Calendars.ACCOUNT_NAME, ACCOUNT)
            put(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
            put(CalendarContract.Calendars.NAME, NAME)
            put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, NAME)
            put(CalendarContract.Calendars.CALENDAR_COLOR, Color.parseColor("#FFD599"))
            put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL, CalendarContract.Calendars.CAL_ACCESS_OWNER)
            put(CalendarContract.Calendars.OWNER_ACCOUNT, ACCOUNT)
            put(CalendarContract.Calendars.VISIBLE, 1)
            put(CalendarContract.Calendars.SYNC_EVENTS, 1)
            put(CalendarContract.Calendars.CALENDAR_TIME_ZONE, TZ)
        }
        val uri = cr.insert(asSync(CalendarContract.Calendars.CONTENT_URI), v) ?: error("Não deu para criar a agenda")
        return uri.lastPathSegment!!.toLong()
    }

    /** No máximo a cada 10 minutos (vários widgets atualizam juntos). */
    fun sync(ctx: Context, events: JSONArray?) {
        if (events == null || !hasPermission(ctx)) return
        val prefs = ctx.getSharedPreferences("orium", 0)
        val now = System.currentTimeMillis()
        if (now - prefs.getLong("agendaAt", 0) < 10 * 60 * 1000) return
        prefs.edit().putLong("agendaAt", now).apply()

        val cr = ctx.contentResolver
        val cal = calendarId(ctx)
        // eventos que já estão lá: uid → id
        val existing = HashMap<String, Long>()
        cr.query(
            CalendarContract.Events.CONTENT_URI,
            arrayOf(CalendarContract.Events._ID, CalendarContract.Events.SYNC_DATA1),
            "${CalendarContract.Events.CALENDAR_ID}=?",
            arrayOf(cal.toString()),
            null,
        )?.use { c -> while (c.moveToNext()) c.getString(1)?.let { existing[it] = c.getLong(0) } }

        val seen = HashSet<String>()
        for (i in 0 until events.length()) {
            val e = events.getJSONObject(i)
            val uid = e.getString("uid")
            seen += uid
            val (y, mo, d) = e.getString("date").split("-").map { it.toInt() }
            val time = e.optString("time").takeIf { it.isNotBlank() && it != "null" }
            val v = ContentValues().apply {
                put(CalendarContract.Events.CALENDAR_ID, cal)
                put(CalendarContract.Events.TITLE, e.optString("title"))
                put(CalendarContract.Events.DESCRIPTION, e.optString("notes") + "\n" + e.optString("url"))
                put(CalendarContract.Events.SYNC_DATA1, uid)
                put(CalendarContract.Events.HAS_ALARM, 1)
                if (time != null) {
                    val (h, mi) = time.split(":").map { it.toInt() }
                    val c = Calendar.getInstance(TimeZone.getTimeZone(TZ)).apply { clear(); set(y, mo - 1, d, h, mi) }
                    put(CalendarContract.Events.ALL_DAY, 0)
                    put(CalendarContract.Events.EVENT_TIMEZONE, TZ)
                    put(CalendarContract.Events.DTSTART, c.timeInMillis)
                    put(CalendarContract.Events.DTEND, c.timeInMillis + 60 * 60 * 1000)
                } else {
                    // dia inteiro: o Android exige meia-noite em UTC
                    val c = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { clear(); set(y, mo - 1, d, 0, 0) }
                    put(CalendarContract.Events.ALL_DAY, 1)
                    put(CalendarContract.Events.EVENT_TIMEZONE, "UTC")
                    put(CalendarContract.Events.DTSTART, c.timeInMillis)
                    put(CalendarContract.Events.DTEND, c.timeInMillis + 24 * 60 * 60 * 1000)
                }
            }
            val id = existing[uid]?.also {
                cr.update(asSync(CalendarContract.Events.CONTENT_URI), v, "${CalendarContract.Events._ID}=?", arrayOf(it.toString()))
            } ?: cr.insert(asSync(CalendarContract.Events.CONTENT_URI), v)?.lastPathSegment?.toLong() ?: continue

            // lembretes: apaga e recria (Android só aceita "minutos antes")
            cr.delete(CalendarContract.Reminders.CONTENT_URI, "${CalendarContract.Reminders.EVENT_ID}=?", arrayOf(id.toString()))
            val alarms = e.optJSONArray("alarms")
            if (alarms != null) for (j in 0 until alarms.length()) {
                val min = alarms.getInt(j)
                if (min < 0) continue // "9h do dia" não existe no Android; a véspera já avisa
                cr.insert(CalendarContract.Reminders.CONTENT_URI, ContentValues().apply {
                    put(CalendarContract.Reminders.EVENT_ID, id)
                    put(CalendarContract.Reminders.MINUTES, min)
                    put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT)
                })
            }
        }
        // entregue/cancelado: some da agenda
        for ((uid, id) in existing) if (uid !in seen) {
            cr.delete(asSync(CalendarContract.Events.CONTENT_URI), "${CalendarContract.Events._ID}=?", arrayOf(id.toString()))
        }
    }
}
