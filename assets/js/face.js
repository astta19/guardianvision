// ============================================================
// FACE LOGIN — MediaPipe FaceMesh (sem foto, detecção contínua)
// ============================================================

const FACE_THRESHOLD = 0.55;

let _mpLoaded        = false;
let _faceMesh        = null;
let _faceStream      = null;
let _faceDescriptors = [];
let _lastLandmarks   = null;
let _loginRunning    = false;
let _loginStream     = null;
let _loginRafId      = null;

// ── Carregar MediaPipe lazy ──────────────────────────────────
async function carregarMediaPipe() {
  if (_mpLoaded && _faceMesh) return true;
  return new Promise(resolve => {
    if (window.FaceMesh) { _initMesh(resolve); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/face_mesh.js';
    s.crossOrigin = 'anonymous';
    s.onload  = () => _initMesh(resolve);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

function _initMesh(resolve) {
  try {
    _faceMesh = new FaceMesh({ locateFile: f =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${f}`
    });
    _faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    _faceMesh.onResults(r => {
      _lastLandmarks = r.multiFaceLandmarks?.[0] || null;
    });
    _mpLoaded = true;
    resolve(true);
  } catch(e) { resolve(false); }
}

// ── Extrair vetor de 128 floats dos landmarks normalizados ───
function _descritor(lm) {
  let minX=1, minY=1, maxX=0, maxY=0;
  lm.forEach(p => {
    if(p.x<minX) minX=p.x; if(p.x>maxX) maxX=p.x;
    if(p.y<minY) minY=p.y; if(p.y>maxY) maxY=p.y;
  });
  const w=maxX-minX||1, h=maxY-minY||1;
  const IDX=[
    10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,
    400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,
    54,103,67,109,33,7,163,144,145,153,154,155,133,173,157,158,
    159,160,161,246,362,382,381,380,374,373,390,249,263,466,388,387,
  ];
  const v=[];
  IDX.forEach(i => {
    const p=lm[i]||{x:0,y:0};
    v.push((p.x-minX)/w, (p.y-minY)/h);
  });
  return v; // 128 floats
}

function _dist(a, b) {
  let s=0; for(let i=0;i<a.length;i++) s+=(a[i]-b[i])**2; return Math.sqrt(s);
}

// ════════════════════════════════════════════════════════════
// LOGIN — detecção contínua via rAF, sem capturar foto
// ════════════════════════════════════════════════════════════

async function iniciarLoginFacial() {
  const area  = document.getElementById('faceLoginArea');
  const msg   = document.getElementById('faceLoginMsg');
  const btn   = document.getElementById('btnFaceLogin');

  // Toggle: se já aberto, fechar
  if (_loginRunning) { pararLoginFacial(); return; }

  area.style.display = 'flex';
  if (msg) msg.textContent = 'Carregando...';
  if (btn) btn.disabled = true;

  const ok = await carregarMediaPipe();
  if (!ok) {
    if (msg) msg.textContent = 'Erro ao carregar reconhecimento facial.';
    if (btn) btn.disabled = false;
    area.style.display = 'none';
    return;
  }

  try {
    _loginStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } }
    });
  } catch(e) {
    if (msg) msg.textContent = 'Câmera bloqueada. Verifique as permissões.';
    if (btn) btn.disabled = false;
    area.style.display = 'none';
    return;
  }

  const video = document.getElementById('faceLoginVideo');
  video.srcObject = _loginStream;
  await video.play().catch(()=>{});

  _loginRunning  = true;
  if (btn) btn.disabled = false;

  let frames       = 0;
  let detectado    = false;
  let autenticando = false;

  async function loop() {
    if (!_loginRunning) return;

    if (video.readyState >= 2) {
      await _faceMesh.send({ image: video }).catch(()=>{});
      frames++;

      if (!detectado && _lastLandmarks) {
        detectado = true;
        if (msg) msg.textContent = 'Rosto detectado. Verificando...';
      } else if (!detectado && frames > 10) {
        if (msg) msg.textContent = 'Posicione seu rosto na câmera...';
      }

      // Após estabilizar 5 frames com rosto detectado, autenticar
      if (_lastLandmarks && !autenticando && frames >= 5) {
        autenticando = true;
        const email = document.getElementById('faceLoginEmail')?.value.trim();
        if (!email) {
          if (msg) msg.textContent = 'Informe seu e-mail acima para continuar.';
          autenticando = false;
          _lastLandmarks = null;
          frames = 0;
        } else {
          if (msg) msg.textContent = 'Identificando...';
          const desc = _descritor(_lastLandmarks);
          await _autenticarFace(email, desc);
          return; // para o loop após tentativa
        }
      }
    }
    _loginRafId = requestAnimationFrame(loop);
  }

  if (msg) msg.textContent = 'Posicione seu rosto na câmera...';
  _loginRafId = requestAnimationFrame(loop);
}

async function _autenticarFace(email, descritor) {
  const msg = document.getElementById('faceLoginMsg');
  try {
    const res  = await fetch('/api/face-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, descriptor: descritor })
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || 'Não reconhecido');

    if (msg) msg.textContent = 'Identidade confirmada! Entrando...';
    pararLoginFacial();

    const { error } = await sb.auth.signInWithPassword({ email, password: json.face_senha });
    if (error) throw error;

  } catch(e) {
    const msg2 = document.getElementById('faceLoginMsg');
    if (msg2) msg2.textContent = '⚠ ' + e.message;
    // Reiniciar loop para nova tentativa
    setTimeout(() => {
      if (_loginRunning) {
        _lastLandmarks = null;
        let frames2 = 0, detectado2 = false, autenticando2 = false;
        async function loop2() {
          if (!_loginRunning) return;
          if (document.getElementById('faceLoginVideo')?.readyState >= 2) {
            await _faceMesh.send({ image: document.getElementById('faceLoginVideo') }).catch(()=>{});
            frames2++;
            if (!detectado2 && _lastLandmarks) { detectado2=true; if(msg2) msg2.textContent='Rosto detectado. Tente novamente...'; }
            if (_lastLandmarks && !autenticando2 && frames2 >= 5) {
              autenticando2 = true;
              const email2 = document.getElementById('faceLoginEmail')?.value.trim();
              if (email2) { await _autenticarFace(email2, _descritor(_lastLandmarks)); return; }
            }
          }
          _loginRafId = requestAnimationFrame(loop2);
        }
        _loginRafId = requestAnimationFrame(loop2);
      }
    }, 2000);
  }
}

function pararLoginFacial() {
  _loginRunning = false;
  cancelAnimationFrame(_loginRafId);
  _loginRafId = null;
  if (_loginStream) { _loginStream.getTracks().forEach(t=>t.stop()); _loginStream = null; }
  const video = document.getElementById('faceLoginVideo');
  if (video) video.srcObject = null;
  const area = document.getElementById('faceLoginArea');
  if (area) area.style.display = 'none';
  const btn = document.getElementById('btnFaceLogin');
  if (btn) btn.disabled = false;
}

// ════════════════════════════════════════════════════════════
// CADASTRO — Perfil
// ════════════════════════════════════════════════════════════

async function verificarStatusFace() {
  const statusEl    = document.getElementById('faceLoginStatus');
  const activateBtn = document.getElementById('faceActivateBtn');
  const removeBtn   = document.getElementById('faceRemoveBtn');
  if (!statusEl || !currentUser) return;
  try {
    const { data } = await sb
      .from('perfis_usuarios').select('face_descriptor')
      .eq('user_id', currentUser.id).maybeSingle();
    if (data?.face_descriptor?.length) {
      statusEl.innerHTML = '<span style="color:#16a34a">✓ Login facial ativado</span>';
      if (activateBtn) activateBtn.style.display = 'none';
      if (removeBtn)   removeBtn.style.display   = 'inline-flex';
    } else {
      statusEl.textContent = 'Login facial não configurado.';
      if (activateBtn) activateBtn.style.display = 'inline-flex';
      if (removeBtn)   removeBtn.style.display   = 'none';
    }
  } catch { if (statusEl) statusEl.textContent = 'Não foi possível verificar.'; }
}

async function iniciarCadastroFace() {
  setFaceMsg('Carregando reconhecimento facial...', false);
  const ok = await carregarMediaPipe();
  if (!ok) { setFaceMsg('Erro ao carregar. Verifique sua conexão.', true); return; }

  try {
    _faceStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } }
    });
  } catch { setFaceMsg('Câmera negada. Habilite nas configurações.', true); return; }

  const video = document.getElementById('faceVideo');
  video.srcObject = _faceStream;
  await new Promise(r => { video.onloadedmetadata = r; setTimeout(r, 1500); });
  await video.play();

  _faceDescriptors = [];
  document.getElementById('faceWebcamArea').style.display = 'flex';
  document.getElementById('faceActivateBtn').style.display = 'none';
  document.getElementById('faceCaptureMsg').textContent = 'Posicione seu rosto e clique em Capturar (3x).';
  setFaceMsg('', false);
}

async function capturarFace() {
  const video      = document.getElementById('faceVideo');
  const captureMsg = document.getElementById('faceCaptureMsg');
  const btn        = document.getElementById('faceCaptureBtn');

  btn.disabled = true;
  captureMsg.textContent = 'Detectando...';
  _lastLandmarks = null;
  await _faceMesh.send({ image: video }).catch(()=>{});

  if (!_lastLandmarks) {
    captureMsg.textContent = '⚠ Rosto não detectado. Melhore a iluminação e tente novamente.';
    btn.disabled = false;
    return;
  }

  _faceDescriptors.push(_descritor(_lastLandmarks));
  const restantes = 3 - _faceDescriptors.length;

  if (restantes > 0) {
    captureMsg.textContent = `✓ ${_faceDescriptors.length}/3 capturado. Mova levemente a cabeça.`;
    btn.disabled = false;
    return;
  }

  captureMsg.textContent = 'Salvando...';
  await _salvarDescriptor();
}

async function _salvarDescriptor() {
  const media = new Array(128).fill(0).map((_,i) =>
    _faceDescriptors.reduce((s,d) => s+d[i], 0) / _faceDescriptors.length
  );
  const faceSenha = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2,'0')).join('');
  try {
    const ok = await salvarPerfilBanco({ face_descriptor: media, face_senha: faceSenha });
    if (!ok) throw new Error('Falha ao salvar');
    const { error } = await sb.auth.updateUser({ password: faceSenha });
    if (error) throw error;

    pararWebcam();
    document.getElementById('faceWebcamArea').style.display  = 'none';
    document.getElementById('faceRemoveBtn').style.display   = 'inline-flex';
    document.getElementById('faceLoginStatus').innerHTML     = '<span style="color:#16a34a">✓ Login facial ativado</span>';
    setFaceMsg('Login facial ativado com sucesso!', false);
  } catch(e) {
    document.getElementById('faceCaptureMsg').textContent = '';
    document.getElementById('faceCaptureBtn').disabled    = false;
    setFaceMsg('Erro: ' + e.message, true);
  }
}

async function removerFace() {
  if (!confirm('Remover login facial?')) return;
  try {
    await salvarPerfilBanco({ face_descriptor: null, face_senha: null });
    document.getElementById('faceLoginStatus').textContent   = 'Login facial não configurado.';
    document.getElementById('faceActivateBtn').style.display = 'inline-flex';
    document.getElementById('faceRemoveBtn').style.display   = 'none';
    setFaceMsg('Login facial removido.', false);
  } catch(e) { setFaceMsg('Erro: ' + e.message, true); }
}

function cancelarCadastroFace() {
  pararWebcam();
  document.getElementById('faceWebcamArea').style.display   = 'none';
  document.getElementById('faceActivateBtn').style.display  = 'inline-flex';
  document.getElementById('faceCaptureMsg').textContent     = '';
  _faceDescriptors = [];
  setFaceMsg('', false);
}

function pararWebcam() {
  if (_faceStream) { _faceStream.getTracks().forEach(t=>t.stop()); _faceStream = null; }
  const video = document.getElementById('faceVideo');
  if (video) video.srcObject = null;
}

function setFaceMsg(txt, isError) {
  const el = document.getElementById('faceMsg');
  if (!el) return;
  el.textContent = txt;
  el.className   = 'auth-msg' + (txt ? (isError ? ' error' : ' success') : '');
}
