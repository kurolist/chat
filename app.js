// ===== CONFIGURATION =====
const CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// ===== STATE =====
let state = {
    mode: null,
    peerConnections: new Map(),
    localStream: null,
    remoteStream: null,
    connectionCode: null,
    dataChannels: new Map()
};

// ===== UI ELEMENTS =====
const elements = {
    broadcasterBtn: document.getElementById('broadcasterBtn'),
    listenerBtn: document.getElementById('listenerBtn'),
    broadcasterSection: document.getElementById('broadcasterSection'),
    listenerSection: document.getElementById('listenerSection'),
    
    startBroadcastBtn: document.getElementById('startBroadcastBtn'),
    stopBroadcastBtn: document.getElementById('stopBroadcastBtn'),
    broadcasterStatus: document.getElementById('broadcasterStatus'),
    connectionCode: document.getElementById('connectionCode'),
    listeners: document.getElementById('listeners'),
    
    connectBtn: document.getElementById('connectBtn'),
    disconnectBtn: document.getElementById('disconnectBtn'),
    codeInput: document.getElementById('codeInput'),
    listenerStatus: document.getElementById('listenerStatus'),
    remoteAudio: document.getElementById('remoteAudio'),
    volumeInfo: document.getElementById('volumeInfo'),
    volumeLevel: document.getElementById('volumeLevel')
};

// ===== UTILITY FUNCTIONS =====
function generateCode() {
    return 'CODE-' + Math.random().toString(36).substr(2, 9).toUpperCase();
}

function updateStatus(element, message, type = 'info') {
    element.textContent = message;
    element.style.color = type === 'error' ? '#e74c3c' : type === 'success' ? '#27ae60' : '#3498db';
}

function toggleElement(element, show) {
    if (show) {
        element.classList.remove('hidden');
    } else {
        element.classList.add('hidden');
    }
}

function log(message) {
    console.log(`[AudioShare] ${message}`);
}

function saveToStorage(key, value) {
    localStorage.setItem(`audioShare_${key}`, JSON.stringify(value));
}

function getFromStorage(key) {
    const data = localStorage.getItem(`audioShare_${key}`);
    return data ? JSON.parse(data) : null;
}

// ===== BROADCASTER MODE =====
async function initBroadcaster() {
    state.mode = 'broadcaster';
    state.connectionCode = generateCode();
    
    toggleElement(elements.broadcasterSection, true);
    toggleElement(elements.listenerSection, false);
    toggleElement(elements.broadcasterBtn, false);
    toggleElement(elements.listenerBtn, false);
    
    elements.connectionCode.textContent = state.connectionCode;
    updateStatus(elements.broadcasterStatus, '✅ Mode Broadcaster activé. Appuyez sur "Démarrer Broadcast"', 'success');
    
    log(`Broadcaster mode activé. Code: ${state.connectionCode}`);
}

async function startBroadcast() {
    try {
        updateStatus(elements.broadcasterStatus, '🎤 Demande d\'accès au microphone...', 'info');
        
        state.localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });
        
        updateStatus(elements.broadcasterStatus, '✅ Microphone activé! En attente de connexion...', 'success');
        toggleElement(elements.startBroadcastBtn, false);
        toggleElement(elements.stopBroadcastBtn, true);
        
        log('Microphone activé avec succès');
        
        saveToStorage('activeBroadcaster', {
            code: state.connectionCode,
            timestamp: Date.now()
        });
        
    } catch (error) {
        updateStatus(elements.broadcasterStatus, '❌ Erreur: ' + error.message, 'error');
        log(`Erreur microphone: ${error}`);
    }
}

function stopBroadcast() {
    if (state.localStream) {
        state.localStream.getTracks().forEach(track => track.stop());
        state.localStream = null;
    }
    
    state.peerConnections.forEach((peerConnection, peerId) => {
        peerConnection.close();
    });
    state.peerConnections.clear();
    state.dataChannels.clear();
    
    updateStatus(elements.broadcasterStatus, '⏹️ Broadcast arrêté', 'info');
    toggleElement(elements.startBroadcastBtn, true);
    toggleElement(elements.stopBroadcastBtn, false);
    
    localStorage.removeItem(`audioShare_activeBroadcaster`);
    
    elements.listeners.innerHTML = '';
    
    log('Broadcast arrêté');
}

async function handleListenerConnection(offer, listenerId) {
    try {
        log(`Connexion d'un auditeur: ${listenerId}`);
        
        const peerConnection = new RTCPeerConnection({
            iceServers: CONFIG.iceServers
        });
        
        state.peerConnections.set(listenerId, peerConnection);
        
        if (state.localStream) {
            state.localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, state.localStream);
            });
        }
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                saveToStorage(`ice_${listenerId}_${Date.now()}`, {
                    candidate: event.candidate,
                    listenerId: listenerId
                });
            }
        };
        
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        saveToStorage(`answer_${listenerId}`, {
            answer: answer,
            listenerId: listenerId
        });
        
        updateListenersList(listenerId, 'connected');
        
        peerConnection.onconnectionstatechange = () => {
            log(`État de connexion ${listenerId}: ${peerConnection.connectionState}`);
            if (peerConnection.connectionState === 'disconnected' || 
                peerConnection.connectionState === 'failed' ||
                peerConnection.connectionState === 'closed') {
                state.peerConnections.delete(listenerId);
                updateListenersList(listenerId, 'disconnected');
            }
        };
        
    } catch (error) {
        log(`Erreur lors de la connexion du listener: ${error}`);
    }
}

function updateListenersList(listenerId, status) {
    const listItem = document.querySelector(`[data-listener-id="${listenerId}"]`);
    
    if (status === 'connected') {
        if (!listItem) {
            const li = document.createElement('li');
            li.setAttribute('data-listener-id', listenerId);
            li.textContent = `🟢 ${listenerId} - Connecté`;
            elements.listeners.appendChild(li);
        }
    } else if (status === 'disconnected') {
        if (listItem) {
            listItem.remove();
        }
    }
}

// ===== LISTENER MODE =====
async function initListener() {
    state.mode = 'listener';
    
    toggleElement(elements.broadcasterSection, false);
    toggleElement(elements.listenerSection, true);
    toggleElement(elements.broadcasterBtn, false);
    toggleElement(elements.listenerBtn, false);
    
    updateStatus(elements.listenerStatus, '⏳ En attente de code...', 'info');
    
    log('Listener mode activé');
}

async function connectTobroadcaster() {
    const code = elements.codeInput.value.trim().toUpperCase();
    
    if (!code) {
        updateStatus(elements.listenerStatus, '❌ Veuillez entrer un code', 'error');
        return;
    }
    
    try {
        updateStatus(elements.listenerStatus, '🔍 Recherche du broadcaster...', 'info');
        
        const broadcaster = getFromStorage('activeBroadcaster');
        
        if (!broadcaster || broadcaster.code !== code) {
            updateStatus(elements.listenerStatus, '❌ Code invalide ou broadcaster non trouvé', 'error');
            log('Broadcaster non trouvé avec le code: ' + code);
            return;
        }
        
        updateStatus(elements.listenerStatus, '🤝 Établissement de la connexion...', 'info');
        
        const listenerId = 'LISTENER-' + Math.random().toString(36).substr(2, 9).toUpperCase();
        const peerConnection = new RTCPeerConnection({
            iceServers: CONFIG.iceServers
        });
        
        state.peerConnections.set('broadcaster', peerConnection);
        
        peerConnection.ontrack = (event) => {
            log('Piste distante reçue');
            state.remoteStream = event.streams[0];
            elements.remoteAudio.srcObject = state.remoteStream;
            elements.remoteAudio.play().catch(err => log(`Erreur play: ${err}`));
            
            updateStatus(elements.listenerStatus, '✅ Connecté! Vous écoutez...', 'success');
            toggleElement(elements.volumeInfo, true);
            
            setupVolumeDisplay();
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                saveToStorage(`ice_listener_${Date.now()}`, {
                    candidate: event.candidate,
                    listenerId: listenerId
                });
            }
        };
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        saveToStorage(`offer_${code}`, {
            offer: offer,
            listenerId: listenerId,
            code: code
        });
        
        const answerCheckInterval = setInterval(async () => {
            const answer = getFromStorage(`answer_${listenerId}`);
            
            if (answer) {
                clearInterval(answerCheckInterval);
                log('Réponse du broadcaster reçue');
                
                try {
                    await peerConnection.setRemoteDescription(
                        new RTCSessionDescription(answer.answer)
                    );
                    
                    toggleElement(elements.connectBtn, false);
                    toggleElement(elements.disconnectBtn, true);
                    
                } catch (error) {
                    log(`Erreur lors du traitement de la réponse: ${error}`);
                    updateStatus(elements.listenerStatus, '❌ Erreur de connexion', 'error');
                }
            }
        }, 500);
        
        setTimeout(() => {
            clearInterval(answerCheckInterval);
            if (peerConnection.connectionState === 'new' || peerConnection.connectionState === 'connecting') {
                updateStatus(elements.listenerStatus, '❌ Timeout - Broadcaster non trouvé', 'error');
            }
        }, 30000);
        
    } catch (error) {
        updateStatus(elements.listenerStatus, '❌ Erreur: ' + error.message, 'error');
        log(`Erreur connexion: ${error}`);
    }
}

function disconnectListener() {
    const peerConnection = state.peerConnections.get('broadcaster');
    
    if (peerConnection) {
        peerConnection.close();
        state.peerConnections.delete('broadcaster');
    }
    
    if (elements.remoteAudio) {
        elements.remoteAudio.srcObject = null;
    }
    
    updateStatus(elements.listenerStatus, '⏹️ Déconnecté', 'info');
    toggleElement(elements.connectBtn, true);
    toggleElement(elements.disconnectBtn, false);
    toggleElement(elements.volumeInfo, false);
    
    elements.codeInput.value = '';
    
    log('Déconnecté du broadcaster');
}

function setupVolumeDisplay() {
    if (!state.remoteStream) return;
    
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(state.remoteStream);
    
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    function updateVolume() {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        const volume = Math.round((average / 255) * 100);
        
        elements.volumeLevel.textContent = volume + '%';
        
        if (state.peerConnections.get('broadcaster')) {
            requestAnimationFrame(updateVolume);
        }
    }
    
    updateVolume();
}

// ===== EVENT LISTENERS =====
elements.broadcasterBtn.addEventListener('click', initBroadcaster);
elements.listenerBtn.addEventListener('click', initListener);

elements.startBroadcastBtn.addEventListener('click', startBroadcast);
elements.stopBroadcastBtn.addEventListener('click', stopBroadcast);

elements.connectBtn.addEventListener('click', connectTobroadcaster);
elements.disconnectBtn.addEventListener('click', disconnectListener);

setInterval(() => {
    if (state.mode === 'broadcaster' && state.localStream) {
        for (const key in localStorage) {
            if (key.includes('offer_') && key.includes(state.connectionCode)) {
                const offerData = getFromStorage(key.replace('audioShare_', ''));
                if (offerData && !state.peerConnections.has(offerData.listenerId)) {
                    handleListenerConnection(offerData.offer, offerData.listenerId);
                    localStorage.removeItem(key);
                }
            }
        }
    }
}, 1000);

log('Application initialisée');
