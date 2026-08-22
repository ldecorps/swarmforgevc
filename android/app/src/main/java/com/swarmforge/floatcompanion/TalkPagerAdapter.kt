package com.swarmforge.floatcompanion

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.swarmforge.floatcompanion.databinding.RemotePageBinding
import com.swarmforge.floatcompanion.databinding.TalkPanelPageBinding

/**
 * BL-829 required_wiring (corrected from the ticket's cited MainActivity.kt —
 * see the coder's note to specifier+coordinator on this parcel: MainActivity
 * is the pairing-only screen and is never shown once paired, so a host
 * instantiated there would be the exact BL-419 unreachable-host shape the
 * wiring check exists to catch; TalkPanelActivity, which OverlayService
 * actually launches to expand Bubble, is where the pager — and so this
 * adapter, and so [RemotePageHost] — is reachable).
 *
 * Drives [rootBinding.pager][ActivityTalkPanelBinding] with a plain
 * RecyclerView.Adapter (not FragmentStateAdapter): [PagerListResolver]
 * already decided the page list once, in [TalkPanelActivity.currentPagerList],
 * so there is nothing here that needs Fragment-level state restoration.
 * Position 0 is always [PagerListResolver.PagerEntry.Talk]; every position
 * after it is a [RemotePageHost]-backed WebView page.
 */
class TalkPagerAdapter(
    private val pagerList: PagerListResolver.PagerList,
    private val baseUrl: String,
    private val onTalkPageCreated: (TalkPanelPageBinding) -> Unit
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    private class TalkViewHolder(binding: TalkPanelPageBinding) : RecyclerView.ViewHolder(binding.root)

    private class RemoteViewHolder(binding: RemotePageBinding) : RecyclerView.ViewHolder(binding.root) {
        val host = RemotePageHost(binding.remoteWebView, binding.remoteFailureReason)
    }

    override fun getItemCount(): Int = pagerList.entries.size

    override fun getItemViewType(position: Int): Int =
        if (pagerList.entries[position] is PagerListResolver.PagerEntry.Talk) VIEW_TYPE_TALK else VIEW_TYPE_REMOTE

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(parent.context)
        return if (viewType == VIEW_TYPE_TALK) {
            val pageBinding = TalkPanelPageBinding.inflate(inflater, parent, false)
            onTalkPageCreated(pageBinding)
            TalkViewHolder(pageBinding)
        } else {
            RemoteViewHolder(RemotePageBinding.inflate(inflater, parent, false))
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        val entry = pagerList.entries[position]
        if (holder is RemoteViewHolder && entry is PagerListResolver.PagerEntry.Remote) {
            holder.host.load(baseUrl, entry.page)
        }
    }

    companion object {
        private const val VIEW_TYPE_TALK = 0
        private const val VIEW_TYPE_REMOTE = 1
    }
}
