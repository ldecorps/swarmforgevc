"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.startBridge = startBridge;
const http = __importStar(require("http"));
const bridgeState_1 = require("./bridgeState");
const bridgeAuth_1 = require("./bridgeAuth");
const DEFAULT_POLL_INTERVAL_MS = 1000;
const LOCALHOST = '127.0.0.1';
function stateForRoute(state, route) {
    switch (route) {
        case '/pipeline':
            return state.pipeline;
        case '/agents':
            return state.agents;
        case '/backlog':
            return state.backlog;
        case '/runlog':
            return state.runLog;
    }
}
function isStateRoute(url) {
    return url === '/pipeline' || url === '/agents' || url === '/backlog' || url === '/runlog';
}
function startBridge(targetPath, runLogPath, token, options = {}) {
    const port = options.port ?? 0;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    return new Promise((resolve) => {
        const sseClients = new Set();
        let lastSnapshot;
        const server = http.createServer((req, res) => {
            const url = req.url ?? '/';
            if (!(0, bridgeAuth_1.isAuthorizedRequest)(req.headers.authorization, token)) {
                res.writeHead(401, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'unauthorized' }));
                return;
            }
            if (url === '/events') {
                res.writeHead(200, {
                    'content-type': 'text/event-stream',
                    'cache-control': 'no-cache',
                    connection: 'keep-alive',
                });
                const snapshot = lastSnapshot ?? JSON.stringify((0, bridgeState_1.buildBridgeState)(targetPath, runLogPath));
                res.write(`data: ${snapshot}\n\n`);
                sseClients.add(res);
                req.on('close', () => sseClients.delete(res));
                return;
            }
            if (isStateRoute(url)) {
                const state = (0, bridgeState_1.buildBridgeState)(targetPath, runLogPath);
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify(stateForRoute(state, url)));
                return;
            }
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'not_found' }));
        });
        const poll = setInterval(() => {
            if (sseClients.size === 0) {
                return;
            }
            const snapshot = JSON.stringify((0, bridgeState_1.buildBridgeState)(targetPath, runLogPath));
            if (snapshot === lastSnapshot) {
                return;
            }
            lastSnapshot = snapshot;
            for (const client of sseClients) {
                client.write(`data: ${snapshot}\n\n`);
            }
        }, pollIntervalMs);
        poll.unref();
        server.listen(port, LOCALHOST, () => {
            const address = server.address();
            const boundPort = typeof address === 'object' && address ? address.port : port;
            resolve({
                port: boundPort,
                token,
                stop: () => {
                    clearInterval(poll);
                    for (const client of sseClients) {
                        client.end();
                    }
                    sseClients.clear();
                    server.close();
                },
            });
        });
    });
}
//# sourceMappingURL=bridgeServer.js.map