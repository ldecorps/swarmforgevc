package com.swarmforge.floatcompanion

import android.os.Bundle
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.swarmforge.floatcompanion.databinding.ActivityKnowledgeBinding

/**
 * BL-908: the browsable knowledge screen — read-only backlog and docs
 * panels over what [CompanionPackageStore] holds on the device. Every panel
 * DECISION (what a folder lists, what a ticket's detail shows, what
 * generation a view states, what to say when nothing is held) lives in
 * [KnowledgeReader], pure and JVM-tested; this activity is the
 * device-surface wiring around it — verified by the BL-908 recorded manual
 * procedure (Bubble testability boundary, BL-769), not the JVM unit suite.
 */
class KnowledgeActivity : AppCompatActivity() {

    private enum class Tab { BACKLOG, DOCS }
    private enum class Folder { ACTIVE, PAUSED, HOLD, DONE }

    private lateinit var binding: ActivityKnowledgeBinding
    private var tab = Tab.BACKLOG
    private var folder = Folder.ACTIVE

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityKnowledgeBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.closeBtn.setOnClickListener { finish() }
        binding.syncBtnHeader.setOnClickListener { sync() }
        binding.tabBacklog.setOnClickListener { tab = Tab.BACKLOG; render() }
        binding.tabDocs.setOnClickListener { tab = Tab.DOCS; render() }
        binding.folderActive.setOnClickListener { folder = Folder.ACTIVE; render() }
        binding.folderPaused.setOnClickListener { folder = Folder.PAUSED; render() }
        binding.folderHold.setOnClickListener { folder = Folder.HOLD; render() }
        binding.folderDone.setOnClickListener { folder = Folder.DONE; render() }
        binding.syncBtn.setOnClickListener { sync() }

        render()
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    private fun sync() {
        val baseUrl = CompanionPrefs.getBaseUrl(this)
        val token = CompanionPrefs.getToken(this)
        Thread {
            CompanionPackageStore.sync(this, baseUrl, token)
            runOnUiThread { if (!isFinishing) render() }
        }.start()
    }

    private fun render() {
        binding.tabBacklog.isEnabled = tab != Tab.BACKLOG
        binding.tabDocs.isEnabled = tab != Tab.DOCS
        binding.folderChips.visibility = if (tab == Tab.BACKLOG) View.VISIBLE else View.GONE

        when (tab) {
            Tab.BACKLOG -> renderBacklog()
            Tab.DOCS -> renderDocs()
        }
    }

    private fun renderBacklog() {
        binding.folderActive.isEnabled = folder != Folder.ACTIVE
        binding.folderPaused.isEnabled = folder != Folder.PAUSED
        binding.folderHold.isEnabled = folder != Folder.HOLD
        binding.folderDone.isEnabled = folder != Folder.DONE

        val read = CompanionPackageStore.read(this, "backlog")
        when (val state = KnowledgeReader.backlogPanelState(read)) {
            is KnowledgeReader.BacklogPanelState.NothingHeld ->
                showEmpty(getString(R.string.knowledge_nothing_synced))
            is KnowledgeReader.BacklogPanelState.Malformed ->
                showEmpty(getString(R.string.knowledge_malformed, "backlog", state.reason))
            is KnowledgeReader.BacklogPanelState.Ready -> {
                showGeneration(state.generation)
                val tickets = when (folder) {
                    Folder.ACTIVE -> state.folders.active
                    Folder.PAUSED -> state.folders.paused
                    Folder.HOLD -> state.folders.hold
                    Folder.DONE -> state.folders.done
                }
                showList(tickets.map { "${it.id} — ${it.title}" }) { index -> showTicketDetail(tickets[index]) }
            }
        }
    }

    private fun renderDocs() {
        val read = CompanionPackageStore.read(this, "docs")
        when (val state = KnowledgeReader.docsPanelState(read)) {
            is KnowledgeReader.DocsPanelState.NothingHeld ->
                showEmpty(getString(R.string.knowledge_nothing_synced))
            is KnowledgeReader.DocsPanelState.Malformed ->
                showEmpty(getString(R.string.knowledge_malformed, "docs", state.reason))
            is KnowledgeReader.DocsPanelState.Ready -> {
                showGeneration(state.generation)
                val labels = state.vision.map { doc -> docLabel(doc) }
                showList(labels) { index -> showDocDetail(state.vision[index]) }
            }
        }
    }

    private fun docLabel(doc: KnowledgeReader.VisionDoc): String =
        if (doc.kind == "mermaid") getString(R.string.knowledge_diagram_title, doc.title) else doc.title

    private fun showGeneration(generation: String) {
        binding.generationText.text = getString(R.string.knowledge_generation, generation)
        binding.generationText.visibility = View.VISIBLE
    }

    private fun showEmpty(message: String) {
        binding.generationText.visibility = View.GONE
        binding.listContainer.visibility = View.GONE
        binding.emptyState.visibility = View.VISIBLE
        binding.emptyStateText.text = message
    }

    private fun showList(labels: List<String>, onClick: (Int) -> Unit) {
        binding.emptyState.visibility = View.GONE
        binding.listContainer.visibility = View.VISIBLE
        binding.listContainer.removeAllViews()
        if (labels.isEmpty()) {
            addRow(getString(R.string.knowledge_empty_folder), null)
            return
        }
        labels.forEachIndexed { index, label -> addRow(label) { onClick(index) } }
    }

    private fun addRow(label: String, onClick: (() -> Unit)?) {
        val row = TextView(this).apply {
            text = label
            setTextColor(getColor(R.color.sf_text))
            setBackgroundResource(R.drawable.bg_input)
            setPadding(24, 24, 24, 24)
            textSize = 14f
            if (onClick != null) setOnClickListener { onClick() }
        }
        val params = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        params.topMargin = 8
        binding.listContainer.addView(row, params)
    }

    private fun showTicketDetail(ticket: KnowledgeReader.BacklogTicket) {
        val body = buildString {
            ticket.description?.let { append(it) } ?: append(ticket.title)
            ticket.status?.let { append("\n\nstatus: ").append(it) }
            ticket.milestone?.let { append("\nmilestone: ").append(it) }
        }
        AlertDialog.Builder(this)
            .setTitle("${ticket.id} — ${ticket.title}")
            .setMessage(body)
            .setPositiveButton(android.R.string.ok, null)
            .show()
    }

    private fun showDocDetail(doc: KnowledgeReader.VisionDoc) {
        AlertDialog.Builder(this)
            .setTitle(docLabel(doc))
            .setMessage(doc.content)
            .setPositiveButton(android.R.string.ok, null)
            .show()
    }
}
