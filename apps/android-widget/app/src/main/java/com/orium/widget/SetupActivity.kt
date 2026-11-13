package com.orium.widget

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import kotlin.concurrent.thread

/**
 * Tela única do app: cola a chave (ou abre o link orium://widget?key=… do
 * Admin) e pronto. Depois é só adicionar os widgets na tela inicial.
 */
class SetupActivity : Activity() {
    private lateinit var input: EditText
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.parseColor("#101010")
        val dp = resources.displayMetrics.density
        fun pill(color: Int) = GradientDrawable().apply { setColor(color); cornerRadius = 28 * dp }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#101010"))
            setPadding((24 * dp).toInt(), (56 * dp).toInt(), (24 * dp).toInt(), (24 * dp).toInt())
        }
        root.addView(TextView(this).apply { text = "ORIUM"; setTextColor(Color.parseColor("#FFD599")); textSize = 13f; letterSpacing = 0.2f; typeface = Typeface.DEFAULT_BOLD })
        root.addView(TextView(this).apply { text = "Widgets de pedidos"; setTextColor(Color.WHITE); textSize = 30f; typeface = Typeface.DEFAULT_BOLD; setPadding(0, (6 * dp).toInt(), 0, 0) })
        root.addView(TextView(this).apply {
            text = "1. No Admin → Widgets → Android, toque em “Gerar chave”.\n2. Cole a chave aqui e salve (permita o Calendário).\n3. Segure na tela inicial → Widgets → Orium.\n\nAs entregas, cobranças e compras entram sozinhas na agenda “Orium · Pedidos”, com lembretes."
            setTextColor(Color.parseColor("#A9A9A9")); textSize = 15f; setLineSpacing(0f, 1.3f); setPadding(0, (14 * dp).toInt(), 0, (22 * dp).toInt())
        })
        input = EditText(this).apply {
            hint = "ow_…"; setHintTextColor(Color.parseColor("#6F6F6F")); setTextColor(Color.WHITE); textSize = 16f
            background = pill(Color.parseColor("#1F1F1F")); setPadding((20 * dp).toInt(), 0, (20 * dp).toInt(), 0); isSingleLine = true
            setText(Orium.key(this@SetupActivity) ?: "")
        }
        root.addView(input, LinearLayout.LayoutParams(MATCH_PARENT, (56 * dp).toInt()))
        val save = Button(this).apply {
            text = "Salvar e atualizar"; isAllCaps = false; textSize = 16f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#15130F")); background = pill(Color.parseColor("#FFD599"))
            setOnClickListener { save(input.text.toString().trim()) }
        }
        root.addView(save, LinearLayout.LayoutParams(MATCH_PARENT, (56 * dp).toInt()).apply { topMargin = (12 * dp).toInt() })
        status = TextView(this).apply { setTextColor(Color.parseColor("#A9A9A9")); textSize = 14f; gravity = Gravity.START; setPadding(0, (16 * dp).toInt(), 0, 0) }
        root.addView(status, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        setContentView(root)

        intent?.data?.getQueryParameter("key")?.let { input.setText(it); save(it) }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 7) {
            getSharedPreferences("orium", 0).edit().putLong("agendaAt", 0).apply()
            thread { Orium.load(this); runOnUiThread { Orium.refreshAll(this) } }
        }
    }

    private fun save(key: String) {
        if (!key.startsWith("ow_")) {
            Toast.makeText(this, "Essa não parece uma chave da Orium (começa com ow_).", Toast.LENGTH_LONG).show()
            return
        }
        Orium.saveKey(this, key)
        // agenda no celular: pede acesso ao calendário uma vez
        if (!CalendarSync.hasPermission(this)) {
            requestPermissions(arrayOf(android.Manifest.permission.READ_CALENDAR, android.Manifest.permission.WRITE_CALENDAR), 7)
        }
        getSharedPreferences("orium", 0).edit().putLong("agendaAt", 0).apply()
        status.text = "Testando…"
        thread {
            val res = Orium.load(this)
            runOnUiThread {
                res.fold(
                    { s -> status.text = "✓ Conectado! ${s.optString("title")}.\nAgora adicione os widgets na tela inicial." ; Orium.refreshAll(this) },
                    { e -> status.text = "Não funcionou: ${e.message}" },
                )
            }
        }
    }
}
