package com.swarmforge.floatcompanion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.swarmforge.floatcompanion.databinding.OverlayBubbleBinding
import com.swarmforge.floatcompanion.databinding.OverlayRemoveZoneBinding
import kotlin.math.abs

/**
 * BL-707: bubble overlay + owns [TalkEngine] so mic/hands-free survive panel collapse.
 */
class OverlayService : Service() {
    private lateinit var windowManager: WindowManager
    private var bubbleView: View? = null
    private var bubbleParams: WindowManager.LayoutParams? = null
    private var removeZoneView: View? = null
    private var removeTarget: View? = null
    private var removeHot = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private var talkEngine: TalkEngine? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        Thread.setDefaultUncaughtExceptionHandler { _, e ->
            Log.e(TAG, "uncaught", e)
            try {
                openFileOutput("last-crash.txt", Context.MODE_PRIVATE).use { out ->
                    out.write((e.stackTraceToString()).toByteArray())
                }
            } catch (_: Exception) {
            }
        }
        try {
            windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
            startAsForeground(micActive = false)
            talkEngine = TalkEngine(applicationContext)
            showBubble()
            // BL-763: check for a bridge bounce (and auto-reset the session
            // once if one happened) on every overlay start, before resuming
            // hands-free - a stale session id from before a bounce should
            // never be the one hands-free resumes into.
            talkEngine?.syncBridgeInstanceAndSession()
            // BL-765: hold-music catalog + full capability document, same
            // "every overlay start" cadence as the bounce/session sync above.
            talkEngine?.syncChiptunesCatalog()
            // Resume last mode: hands-free cold-start greets then opens the mic.
            talkEngine?.greetAndResumeHandsFreeIfNeeded()
        } catch (e: Exception) {
            Log.e(TAG, "onCreate failed", e)
            Toast.makeText(this, "overlay failed: ${e.message}", Toast.LENGTH_LONG).show()
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_SHOW_BUBBLE -> bubbleView?.visibility = View.VISIBLE
            ACTION_HIDE_BUBBLE -> bubbleView?.visibility = View.GONE
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        talkEngine?.shutdown()
        talkEngine = null
        if (instance === this) instance = null
        hideRemoveZone()
        removeBubble()
        super.onDestroy()
    }

    fun engine(): TalkEngine {
        val existing = talkEngine
        if (existing != null) return existing
        val created = TalkEngine(applicationContext)
        talkEngine = created
        return created
    }

    private var micForeground = false

    private fun buildNotification(): Notification {
        val channelId = "sf_float_overlay"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                getString(R.string.overlay_channel),
                NotificationManager.IMPORTANCE_LOW
            )
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, channelId)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(
                if (micForeground) getString(R.string.overlay_listening)
                else getString(R.string.overlay_running)
            )
            .setSmallIcon(R.drawable.ic_bubble)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    /**
     * Bubble starts as specialUse only. Microphone FGS type is added only while
     * actually recording — claiming mic at Start-bubble crashes phones without
     * RECORD_AUDIO yet (and is rejected by Android 14+ policy).
     */
    private fun startAsForeground(micActive: Boolean) {
        micForeground = micActive
        val notification = buildNotification()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                val types = if (micActive) {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE or
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                } else {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                }
                startForeground(7071, notification, types)
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && micActive) {
                startForeground(
                    7071,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                )
            } else {
                startForeground(7071, notification)
            }
        } catch (e: Exception) {
            Log.e(TAG, "startForeground mic=$micActive failed, falling back", e)
            // Last resort: plain foreground so the bubble still opens.
            try {
                startForeground(7071, notification)
            } catch (e2: Exception) {
                throw e2
            }
        }
    }

    fun updateMicrophoneForeground(active: Boolean) {
        if (micForeground == active) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
                nm.notify(7071, buildNotification())
            }
            return
        }
        startAsForeground(micActive = active)
    }

    private fun overlayType(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

    private fun showBubble() {
        if (bubbleView != null) return
        try {
            val binding = OverlayBubbleBinding.inflate(LayoutInflater.from(this))
            bubbleView = binding.root
            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.TOP or Gravity.START
                x = 48
                y = 240
            }
            bubbleParams = params
            attachDrag(binding.root, params) {
                mainHandler.post { openTalkPanel() }
            }
            windowManager.addView(binding.root, params)
            applyBubbleAppearance(TalkEngine.Phase.READY, paused = false)
        } catch (e: Exception) {
            Log.e(TAG, "showBubble failed", e)
            Toast.makeText(this, "bubble failed: ${e.message}", Toast.LENGTH_LONG).show()
            stopSelf()
        }
    }

    private fun openTalkPanel() {
        try {
            val intent = Intent(this, TalkPanelActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "openTalkPanel failed", e)
            Toast.makeText(this, "open panel failed: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun removeBubble() {
        bubbleView?.let {
            try {
                windowManager.removeView(it)
            } catch (e: Exception) {
                Log.w(TAG, "remove bubble failed", e)
            }
        }
        bubbleView = null
        bubbleParams = null
    }

    private fun showRemoveZone() {
        if (removeZoneView != null) return
        try {
            val binding = OverlayRemoveZoneBinding.inflate(LayoutInflater.from(this))
            removeZoneView = binding.root
            removeTarget = binding.removeTarget
            removeHot = false
            binding.removeTarget.setBackgroundResource(R.drawable.bg_remove_zone)
            binding.removeTarget.scaleX = 1f
            binding.removeTarget.scaleY = 1f
            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
                x = 0
                y = 0
            }
            windowManager.addView(binding.root, params)
        } catch (e: Exception) {
            Log.w(TAG, "showRemoveZone failed", e)
            removeZoneView = null
            removeTarget = null
        }
    }

    private fun hideRemoveZone() {
        removeZoneView?.let {
            try {
                windowManager.removeView(it)
            } catch (e: Exception) {
                Log.w(TAG, "hideRemoveZone failed", e)
            }
        }
        removeZoneView = null
        removeTarget = null
        removeHot = false
    }

    private fun setRemoveHot(hot: Boolean) {
        if (removeHot == hot) return
        removeHot = hot
        val target = removeTarget ?: return
        target.setBackgroundResource(
            if (hot) R.drawable.bg_remove_zone_hot else R.drawable.bg_remove_zone
        )
        val scale = if (hot) 1.25f else 1f
        target.animate().scaleX(scale).scaleY(scale).setDuration(120).start()
    }

    /** True when the bubble is in the bottom dismiss strip (wide, easy drop). */
    private fun isOverRemoveZone(params: WindowManager.LayoutParams, bubble: View): Boolean {
        if (removeZoneView == null) return false
        val dm = resources.displayMetrics
        val bubbleBottom = params.y + bubble.height
        // Whole lower band of the screen — drag down to close, not only dead-center on X.
        val dismissTop = (dm.heightPixels * 0.72f).toInt()
        return bubbleBottom >= dismissTop
    }

    private fun applyBubbleAppearance(phase: TalkEngine.Phase, paused: Boolean) {
        val view = bubbleView ?: return
        val color = ContextCompat.getColor(
            this,
            when {
                paused -> R.color.sf_bubble_paused
                phase == TalkEngine.Phase.READY -> R.color.sf_bubble
                phase == TalkEngine.Phase.RECORDING -> R.color.sf_bubble_recording
                phase == TalkEngine.Phase.THINKING -> R.color.sf_bubble_thinking
                phase == TalkEngine.Phase.SPEAKING -> R.color.sf_bubble_speaking
                phase == TalkEngine.Phase.ERROR -> R.color.sf_bubble_error
                else -> R.color.sf_bubble
            }
        )
        val bg = view.background?.mutate()
        if (bg is GradientDrawable) {
            bg.setColor(color)
            // Keep stroke matching the fill so phase color is a solid disc, not a rim.
            val strokePx = (2f * resources.displayMetrics.density).toInt().coerceAtLeast(1)
            bg.setStroke(strokePx, color)
            view.background = bg
        } else {
            view.setBackgroundColor(color)
        }
    }

    private fun toggleBubblePause() {
        val eng = talkEngine ?: return
        eng.togglePauseAll()
        val snap = eng.snapshot()
        applyBubbleAppearance(snap.phase, snap.pausedAll)
        Toast.makeText(
            this,
            if (snap.pausedAll) R.string.bubble_paused else R.string.bubble_resumed,
            Toast.LENGTH_SHORT
        ).show()
    }

    private fun attachDrag(
        view: View,
        params: WindowManager.LayoutParams,
        onTap: () -> Unit
    ) {
        var downX = 0
        var downY = 0
        var startX = 0
        var startY = 0
        var moved = false
        var longPressFired = false
        // Finger tremor often exceeds 8px and cancels long-press — use system slop * 2.
        val touchSlop = ViewConfiguration.get(view.context).scaledTouchSlop * 2
        val longPressTimeout = ViewConfiguration.getLongPressTimeout().toLong()
        val longPressRunnable = Runnable {
            if (!moved && !longPressFired) {
                longPressFired = true
                view.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
                toggleBubblePause()
            }
        }
        view.setOnTouchListener { v, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    moved = false
                    longPressFired = false
                    downX = event.rawX.toInt()
                    downY = event.rawY.toInt()
                    startX = params.x
                    startY = params.y
                    mainHandler.removeCallbacks(longPressRunnable)
                    mainHandler.postDelayed(longPressRunnable, longPressTimeout)
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX.toInt() - downX
                    val dy = event.rawY.toInt() - downY
                    if (!moved && (abs(dx) > touchSlop || abs(dy) > touchSlop)) {
                        // Long-press already acted — keep this gesture as pause/resume only.
                        if (longPressFired) {
                            return@setOnTouchListener true
                        }
                        mainHandler.removeCallbacks(longPressRunnable)
                        moved = true
                        showRemoveZone()
                    }
                    if (moved) {
                        params.x = startX + dx
                        params.y = startY + dy
                        try {
                            windowManager.updateViewLayout(v, params)
                        } catch (e: Exception) {
                            Log.w(TAG, "drag update failed", e)
                        }
                        setRemoveHot(isOverRemoveZone(params, v))
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    mainHandler.removeCallbacks(longPressRunnable)
                    when {
                        longPressFired -> hideRemoveZone()
                        !moved -> {
                            hideRemoveZone()
                            onTap()
                        }
                        isOverRemoveZone(params, v) -> {
                            hideRemoveZone()
                            Toast.makeText(this, R.string.bubble_closed, Toast.LENGTH_SHORT).show()
                            stopSelf()
                        }
                        else -> {
                            hideRemoveZone()
                            magnetEdge(params, v)
                        }
                    }
                    true
                }
                MotionEvent.ACTION_CANCEL -> {
                    mainHandler.removeCallbacks(longPressRunnable)
                    hideRemoveZone()
                    true
                }
                else -> false
            }
        }
    }

    private fun magnetEdge(params: WindowManager.LayoutParams, view: View) {
        val dm = resources.displayMetrics
        val mid = dm.widthPixels / 2
        params.x = if (params.x + view.width / 2 < mid) 12 else dm.widthPixels - view.width - 12
        try {
            windowManager.updateViewLayout(view, params)
        } catch (e: Exception) {
            Log.w(TAG, "magnet failed", e)
        }
    }

    companion object {
        private const val TAG = "SfFloatOverlay"
        const val ACTION_SHOW_BUBBLE = "com.swarmforge.floatcompanion.SHOW_BUBBLE"
        const val ACTION_HIDE_BUBBLE = "com.swarmforge.floatcompanion.HIDE_BUBBLE"
        const val ACTION_STOP = "com.swarmforge.floatcompanion.STOP"

        @Volatile
        private var instance: OverlayService? = null

        fun engineOrNull(): TalkEngine? = instance?.talkEngine

        fun requireEngine(context: Context): TalkEngine {
            instance?.let { return it.engine() }
            val intent = Intent(context, OverlayService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (e: Exception) {
                Log.w(TAG, "start service for engine failed", e)
            }
            return instance?.engine()
                ?: throw IllegalStateException("OverlayService TalkEngine unavailable")
        }

        fun setMicrophoneForeground(active: Boolean) {
            instance?.mainHandler?.post {
                try {
                    instance?.updateMicrophoneForeground(active)
                } catch (e: Exception) {
                    Log.w(TAG, "setMicrophoneForeground failed", e)
                }
            }
        }

        fun onTalkSnapshot(@Suppress("UNUSED_PARAMETER") context: Context, snapshot: TalkEngine.Snapshot) {
            instance?.mainHandler?.post {
                instance?.applyBubbleAppearance(snapshot.phase, snapshot.pausedAll)
                // Keep FGS mic type aligned with recording only.
                try {
                    instance?.updateMicrophoneForeground(snapshot.phase == TalkEngine.Phase.RECORDING)
                } catch (e: Exception) {
                    Log.w(TAG, "mic FGS update failed", e)
                }
            }
        }

        fun setBubbleVisible(context: Context, visible: Boolean) {
            val intent = Intent(context, OverlayService::class.java).apply {
                action = if (visible) ACTION_SHOW_BUBBLE else ACTION_HIDE_BUBBLE
            }
            try {
                context.startService(intent)
            } catch (e: Exception) {
                Log.w(TAG, "setBubbleVisible failed", e)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, OverlayService::class.java).apply {
                action = ACTION_STOP
            }
            try {
                context.startService(intent)
            } catch (_: Exception) {
                context.stopService(Intent(context, OverlayService::class.java))
            }
        }
    }
}
