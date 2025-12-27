const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

// ✅ Auto-detect port from environment (Render uses PORT env var)
const PORT = process.env.PORT || 3000;

// Express app
const app = express();

// Serve static files
app.use(express.static('public'));

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        uptime: process.uptime(),
        connections: {
            android: androidClients.size,
            browsers: browserClients.size
        }
    });
});

// HTTP server
const server = http.createServer(app);

// WebSocket Server
const wss = new WebSocket.Server({ 
    server,
    path: '/ws'
});

// Client tracking
let androidClients = new Map();
let browserClients = new Map();

const PING_INTERVAL = 25000; // 25 seconds
const CLIENT_TIMEOUT = 90000; // 90 seconds

console.log('🚀 Zeta Signaling Server (Render Edition)');
console.log('━'.repeat(50));

// Heartbeat system untuk semua clients
setInterval(() => {
    const now = Date.now();
    
    wss.clients.forEach((client) => {
        try {
            if (client.readyState === WebSocket.OPEN) {
                // Kirim ping jika sudah lebih dari 25 detik
                if (now - (client.lastPing || 0) > PING_INTERVAL) {
                    client.ping();
                    client.lastPing = now;
                    
                    // Log untuk debugging
                    if (androidClients.has(client.clientId)) {
                        console.log(`💓 Ping to Android: ${client.clientId}`);
                    }
                }
                
                // Cek timeout (no pong in 90 seconds)
                if (now - (client.lastPong || 0) > CLIENT_TIMEOUT) {
                    console.log(`⏰ Client timeout: ${client.clientId}`);
                    
                    // Force close connection
                    try {
                        client.close(1000, 'Timeout - no pong received');
                    } catch (error) {
                        console.error('Error closing client:', error.message);
                    }
                    
                    // Cleanup dari tracking maps
                    if (androidClients.has(client.clientId)) {
                        cleanupAndroidClient(client.clientId);
                    }
                    if (browserClients.has(client.clientId)) {
                        cleanupBrowserClient(client.clientId);
                    }
                }
            }
        } catch (error) {
            console.error('Error in heartbeat:', error.message);
        }
    });
}, 10000); // Check every 10 seconds

// Cleanup stale connections khusus untuk Android
setInterval(() => {
    const now = Date.now();
    androidClients.forEach((client, id) => {
        if (now - client.lastSeen > CLIENT_TIMEOUT) {
            console.log(`⏰ Android timeout: ${id}`);
            cleanupAndroidClient(id);
        }
    });
}, 60000);

wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    const clientId = `${ip}-${Date.now()}`;
    
    console.log(`📱 New connection: ${clientId}`);
    
    // Tambahkan properti tracking ke WebSocket object
    ws.clientId = clientId;
    ws.lastPong = Date.now();
    ws.lastPing = Date.now() - PING_INTERVAL; // Set agar ping segera dilakukan
    
    // Pong handler
    ws.on('pong', () => {
        ws.lastPong = Date.now();
        console.log(`💓 Pong from client: ${clientId}`);
        
        // Update lastSeen untuk Android/Browser clients
        if (androidClients.has(clientId)) {
            androidClients.get(clientId).lastSeen = Date.now();
        } else if (browserClients.has(clientId)) {
            browserClients.get(clientId).lastSeen = Date.now();
        }
    });
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            const type = message.type;
            
            if (type === 'ping') {
                ws.send(JSON.stringify({ 
                    type: 'pong', 
                    timestamp: Date.now(),
                    serverTime: new Date().toISOString()
                }));
                ws.lastPong = Date.now();
                return;
            }
            
            if (type === 'pong') {
                ws.lastPong = Date.now();
                return;
            }
            
            if (type === 'client-type') {
                if (message.client === 'android') {
                    androidClients.set(clientId, {
                        ws: ws,
                        lastSeen: Date.now(),
                        ip: ip
                    });
                    
                    console.log(`✅ Android registered: ${clientId}`);
                    
                    broadcastToBrowsers({
                        type: 'android-connected',
                        androidId: clientId,
                        timestamp: Date.now()
                    });
                    
                    ws.send(JSON.stringify({
                        type: 'welcome',
                        clientId: clientId,
                        message: 'Connected to Zeta Cloud Server'
                    }));
                    
                } else if (message.client === 'browser') {
                    const browserId = message.browserId || clientId;
                    
                    browserClients.set(clientId, {
                        ws: ws,
                        browserId: browserId,
                        lastSeen: Date.now()
                    });
                    
                    console.log(`✅ Browser registered: ${clientId}`);
                    
                    if (androidClients.size > 0) {
                        ws.send(JSON.stringify({
                            type: 'android-available',
                            count: androidClients.size,
                            timestamp: Date.now()
                        }));
                        
                        const firstAndroid = androidClients.values().next().value;
                        if (firstAndroid && firstAndroid.ws.readyState === WebSocket.OPEN) {
                            firstAndroid.ws.send(JSON.stringify({
                                type: 'request-offer',
                                browserId: browserId,
                                timestamp: Date.now()
                            }));
                            console.log(`📤 Requested offer from Android`);
                        }
                    }
                }
                return;
            }
            
            if (androidClients.has(clientId)) {
                console.log(`📤 Android → Browsers: ${type}`);
                androidClients.get(clientId).lastSeen = Date.now();
                message.androidId = clientId;
                broadcastToBrowsers(message);
                
            } else if (browserClients.has(clientId)) {
                const browser = browserClients.get(clientId);
                browser.lastSeen = Date.now();
                
                console.log(`📤 Browser → Android: ${type}`);
                message.browserId = browser.browserId;
                
                if (message.androidId && androidClients.has(message.androidId)) {
                    const android = androidClients.get(message.androidId);
                    if (android.ws.readyState === WebSocket.OPEN) {
                        android.ws.send(JSON.stringify(message));
                    }
                } else {
                    const firstAndroid = androidClients.values().next().value;
                    if (firstAndroid && firstAndroid.ws.readyState === WebSocket.OPEN) {
                        firstAndroid.ws.send(JSON.stringify(message));
                    }
                }
            }
            
        } catch (error) {
            console.error('❌ Parse error:', error.message);
        }
    });
    
    ws.on('close', (code, reason) => {
        console.log(`🔌 Client disconnected: ${code} - ${clientId} - ${reason || 'No reason'}`);
        
        // Hapus properti
        delete ws.clientId;
        delete ws.lastPong;
        delete ws.lastPing;
        
        if (androidClients.has(clientId)) {
            cleanupAndroidClient(clientId);
        }
        
        if (browserClients.has(clientId)) {
            cleanupBrowserClient(clientId);
        }
    });
    
    ws.on('error', (error) => {
        console.error(`❌ WebSocket error: ${error.message} - ${clientId}`);
    });
});

function broadcastToBrowsers(message) {
    const data = JSON.stringify(message);
    let successCount = 0;
    
    browserClients.forEach((client, id) => {
        if (client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.send(data);
                successCount++;
            } catch (error) {
                console.error(`❌ Broadcast failed: ${error.message}`);
            }
        }
    });
    
    if (successCount > 0) {
        console.log(`✅ Broadcast to ${successCount} browser(s)`);
    }
}

function cleanupAndroidClient(clientId) {
    if (androidClients.has(clientId)) {
        const client = androidClients.get(clientId);
        if (client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.close(1000, 'Android cleanup');
            } catch (error) {
                // Ignore
            }
        }
        androidClients.delete(clientId);
        console.log(`❌ Android disconnected: ${clientId}`);
        
        broadcastToBrowsers({
            type: 'android-disconnected',
            androidId: clientId,
            timestamp: Date.now()
        });
    }
}

function cleanupBrowserClient(clientId) {
    if (browserClients.has(clientId)) {
        const client = browserClients.get(clientId);
        if (client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.close(1000, 'Browser cleanup');
            } catch (error) {
                // Ignore
            }
        }
        browserClients.delete(clientId);
        console.log(`❌ Browser disconnected: ${clientId}`);
    }
}

// Start server
server.listen(PORT, () => {
    console.log(`\n💡 Server running on port ${PORT}`);
    console.log(`🌐 WebSocket endpoint: wss://[your-app].onrender.com/ws`);
    console.log(`💓 Heartbeat interval: ${PING_INTERVAL/1000}s, Timeout: ${CLIENT_TIMEOUT/1000}s`);
    console.log('⏳ Waiting for connections...\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down...');
    
    androidClients.forEach((client) => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.close(1000, 'Server shutting down');
        }
    });
    
    browserClients.forEach((client) => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.close(1000, 'Server shutting down');
        }
    });
    
    wss.close(() => {
        server.close(() => {
            console.log('✅ Server closed');
            process.exit(0);
        });
    });
});
