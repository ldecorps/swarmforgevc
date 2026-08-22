package com.swarmforge.floatcompanion

import android.view.View
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView

/**
 * BL-829: the device edge that actually loads a [PagerListResolver.RemotePage]
 * into a WebView, instantiated per pager page by [TalkPagerAdapter]. Pairs
 * with [PagerListResolver] (the pure decision of WHICH pages exist and in
 * what order) the same way [BridgeClient] pairs with [UiBundleResolver] —
 * this class owns only the `android.*` rendering step, never the allowlist
 * decision itself.
 *
 * A load failure never leaves a blank WebView (BL-829 invariant 3, device
 * half of [PagerListResolverBareReasonPropertyTest]'s pure half): the main
 * frame's error swaps the WebView out for [reasonView] naming the page and
 * a stated reason.
 */
class RemotePageHost(private val webView: WebView, private val reasonView: TextView) {

    fun load(baseUrl: String, page: PagerListResolver.RemotePage) {
        reasonView.visibility = View.GONE
        webView.visibility = View.VISIBLE
        webView.settings.javaScriptEnabled = true
        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request == null || request.isForMainFrame) {
                    showFailure("Can't open ${page.title} right now.")
                }
            }
        }
        webView.loadUrl(resolveUrl(baseUrl, page.entryPath))
    }

    fun showFailure(reason: String) {
        webView.visibility = View.GONE
        reasonView.text = reason
        reasonView.visibility = View.VISIBLE
    }

    companion object {
        fun resolveUrl(baseUrl: String, entryPath: String): String =
            baseUrl.trimEnd('/') + "/" + entryPath.trimStart('/')
    }
}
