// ============================================================
// FACE LOGIN — MediaPipe FaceMesh
// Cadastro (Perfil) + Login (tela de entrada)
// Deps: sb, currentUser, salvarPerfilBanco, showToast, doLogin
// ============================================================

const FACE_THRESHOLD = 0.55; // distância euclidiana máxima p/ match

let _mpLoaded        = false;
let _faceMesh        = null;
let _faceStream      = null;
let _faceDescriptors = []; // capturas durante cadastro
let _lastLandmarks   = null; // último frame do FaceMesh

// ── 1. Carregar MediaPipe lazy ───────────────────────────────
async function carregarMediaPipe() {
  if (_mpLoaded && _faceMesh) return true;
  return new Promise(resolve => {
    if (window.FaceMesh) { _iniciarFaceMesh(resolve); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/face_mesh.js';
    s.crossOrigin = 'anonymous';
    s.onload  = () => _iniciarFaceMesh(resolve);
    s.onerror = () => { console.error('[face] falha ao carregar MediaPipe'); resolve(false); };
    document.head.appendChild(s);
  });
}

function _iniciarFaceMesh(resolve) {
  try {
    _faceMesh = new FaceMesh({ locateFile: f =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${f}`
    });
    _faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: false,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    _faceMesh.onResults(r => {
      _lastLandmarks = r.multiFaceLandmarks?.[0] || null;
    });
    _mpLoaded = true;
    resolve(true);
  } catch(e) {
    console.error('[face] erro ao iniciar FaceMesh:', e);
    resolve(false);
  }
}

// ── 2. Extrair descritor de 128 floats a partir dos landmarks ─
// Usa 128 pontos-chave normalizados do FaceMesh como vetor de embedding
function _extrairDescritor(landmarks) {
  // Normalizar pelo bounding box do rosto
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  landmarks.forEach(p => {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  });
  const w = maxX - minX || 1, h = maxY - minY || 1;

  // Selecionar 64 pontos representativos (contorno, olhos, nariz, boca)
  const INDICES = [
    10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,
    400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,
    54,103,67,109, 33,7,163,144,145,153,154,155,133,173,157,158,
    159,160,161,246, 362,382,381,380,374,373,390,249,263,466,388,387,
  ];

  const vec = [];
  INDICES.forEach(i => {
    const p = landmarks[i] || { x: 0, y: 0 };
    vec.push((p.x - minX) / w);
    vec.push((p.y - minY) / h);
  });
  return vec; // 128 floats
}

// ── 3. Distância euclidiana entre dois descritores ───────────
function _distancia(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

// ── 4. Capturar frame do vídeo e processar ───────────────────
async function _processarFrame(video) {
  _lastLandmarks = null;
  await _faceMesh.send({ image: video });
  return _lastLandmarks;
}

// ════════════════════════════════════════════════════════════
// CADASTRO — funções chamadas pelo Perfil
// ════════════════════════════════════════════════════════════

async function verificarStatusFace() {
  const statusEl    = document.getElementById('faceLoginStatus');
  const activateBtn = document.getElementById('faceActivateBtn');
  const removeBtn   = document.getElementById('faceRemoveBtn');
  if (!statusEl || !currentUser) return;
  try {
    const { data } = await sb
      .from('perfis_usuarios')
      .select('face_descriptor')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (data?.face_descriptor?.length) {
      statusEl.innerHTML = '<span style="color:#16a34a">✓ Login facial ativado</span>';
      if (activateBtn) activateBtn.style.display = 'none';
      if (removeBtn)   removeBtn.style.display   = 'inline-flex';
    } else {
      statusEl.textContent = 'Login facial não configurado.';
      if (activateBtn) activateBtn.style.display = 'inline-flex';
      if (removeBtn)   removeBtn.style.display   = 'none';
    }
  } catch(e) {
    statusEl.textContent = 'Não foi possível verificar o status.';
  }
}

async function iniciarCadastroFace() {
  setFaceMsg('Carregando reconhecimento facial...', false);
  const ok = await carregarMediaPipe();
  if (!ok) { setFaceMsg('Erro ao carregar. Verifique sua conexão.', true); return; }

  try {
    _faceStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 } });
  } catch(e) {
    setFaceMsg('Câmera negada. Habilite nas configurações do navegador.', true); return;
  }

  const video = document.getElementById('faceVideo');
  video.srcObject = _faceStream;
  await new Promise(res => { video.onloadedmetadata = res; setTimeout(res, 1500); });
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
  if (captureMsg) captureMsg.textContent = 'Detectando...';

  const landmarks = await _processarFrame(video);

  if (!landmarks) {
    captureMsg.textContent = '⚠ Rosto não detectado. Melhore a iluminação e tente novamente.';
    btn.disabled = false;
    return;
  }

  _faceDescriptors.push(_extrairDescritor(landmarks));
  const restantes = 3 - _faceDescriptors.length;

  if (restantes > 0) {
    captureMsg.textContent = `✓ ${_faceDescriptors.length}/3 capturado. Mova levemente a cabeça e capture novamente.`;
    btn.disabled = false;
    return;
  }

  captureMsg.textContent = 'Salvando...';
  await _salvarDescriptorFace();
}

async function _salvarDescriptorFace() {
  // Média dos 3 descritores
  const media = new Array(128).fill(0).map((_, i) =>
    _faceDescriptors.reduce((s, d) => s + d[i], 0) / _faceDescriptors.length
  );

  // Senha aleatória para autenticar via Supabase Auth após validação facial
  const faceSenha = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  try {
    const ok = await salvarPerfilBanco({ face_descriptor: media, face_senha: faceSenha });
    if (!ok) throw new Error('Falha ao salvar no banco');

    const { error } = await sb.auth.updateUser({ password: faceSenha });
    if (error) throw error;

    pararWebcam();
    document.getElementById('faceWebcamArea').style.display = 'none';
    document.getElementById('faceRemoveBtn').style.display  = 'inline-flex';
    document.getElementById('faceLoginStatus').innerHTML    = '<span style="color:#16a34a">✓ Login facial ativado</span>';
    setFaceMsg('Login facial ativado com sucesso!', false);
  } catch(e) {
    document.getElementById('faceCaptureMsg').textContent = '';
    document.getElementById('faceCaptureBtn').disabled    = false;
    setFaceMsg('Erro ao salvar: ' + e.message, true);
  }
}

async function removerFace() {
  if (!confirm('Remover login facial? Você voltará a usar e-mail e senha.')) return;
  try {
    await salvarPerfilBanco({ face_descriptor: null, face_senha: null });
    document.getElementById('faceLoginStatus').textContent  = 'Login facial não configurado.';
    document.getElementById('faceActivateBtn').style.display = 'inline-flex';
    document.getElementById('faceRemoveBtn').style.display   = 'none';
    setFaceMsg('Login facial removido.', false);
  } catch(e) {
    setFaceMsg('Erro ao remover: ' + e.message, true);
  }
}

function cancelarCadastroFace() {
  pararWebcam();
  document.getElementById('faceWebcamArea').style.display   = 'none';
  document.getElementById('faceActivateBtn').style.display  = 'inline-flex';
  document.getElementById('faceCaptureMsg').textContent     = '';
  _faceDescriptors = [];
  setFaceMsg('', false);
}

// ════════════════════════════════════════════════════════════
// LOGIN FACIAL — tela de entrada
// ════════════════════════════════════════════════════════════

let _faceLoginStream   = null;
let _faceLoginInterval = null;

async function iniciarLoginFacial() {
  const area  = document.getElementById('faceLoginArea');
  const msg   = document.getElementById('faceLoginMsg');
  const btnAb = document.getElementById('btnFaceLogin');

  if (area.style.display === 'flex') {
    pararLoginFacial(); return;
  }

  if (msg) msg.textContent = 'Carregando...';
  if (btnAb) btnAb.disabled = true;

  const ok = await carregarMediaPipe();
  if (!ok) {
    if (msg) msg.textContent = 'Erro ao carregar reconhecimento.';
    if (btnAb) btnAb.disabled = false;
    return;
  }

  try {
    _faceLoginStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 } });
  } catch(e) {
    if (msg) msg.textContent = 'Câmera negada.';
    if (btnAb) btnAb.disabled = false;
    return;
  }

  const video = document.getElementById('faceLoginVideo');
  video.srcObject = _faceLoginStream;
  await new Promise(res => { video.onloadedmetadata = res; setTimeout(res, 1500); });
  await video.play();

  area.style.display = 'flex';
  if (msg) msg.textContent = 'Aproxime seu rosto da câmera...';
  if (btnAb) { btnAb.textContent = 'Cancelar'; btnAb.disabled = false; }

  // Processar frames continuamente até autenticar
  let tentativas = 0;
  _faceLoginInterval = setInterval(async () => {
    if (tentativas > 30) { // ~15 segundos
      pararLoginFacial();
      if (msg) msg.textContent = 'Tempo esgotado. Tente novamente.';
      document.getElementById('btnFaceLogin').textContent = 'Entrar com rosto';
      return;
    }
    tentativas++;
    const landmarks = await _processarFrame(video);
    if (!landmarks) return;

    if (msg) msg.textContent = 'Rosto detectado. Verificando identidade...';
    clearInterval(_faceLoginInterval);
    await _autenticarFace(_extrairDescritor(landmarks));
  }, 500);
}

async function _autenticarFace(descritor) {
  const msg   = document.getElementById('faceLoginMsg');
  const btnAb = document.getElementById('btnFaceLogin');

  try {
    // Buscar todos os usuários com face cadastrada
    // A query retorna apenas email + face_descriptor + face_senha do próprio usuário
    // Como não sabemos quem é ainda, buscamos via RPC ou com anon key
    // Solução: buscar por similaridade — o usuário informa o e-mail E usa o rosto
    // OU: criar endpoint API para não expor dados de outros usuários

    // Abordagem simples e segura: pedir o e-mail na tela de login facial
    const email = document.getElementById('faceLoginEmail')?.value.trim();
    if (!email) {
      if (msg) msg.textContent = 'Informe seu e-mail para o login facial.';
      pararLoginFacial();
      document.getElementById('btnFaceLogin').textContent = 'Entrar com rosto';
      return;
    }

    // Buscar perfil do usuário pelo e-mail via API (service key no backend)
    const res  = await fetch('/api/face-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, descriptor: descritor })
    });
    const json = await res.json();

    if (!res.ok || json.error) throw new Error(json.error || 'Falha na autenticação');

    // Autenticar com a face_senha retornada
    if (msg) msg.textContent = 'Identidade confirmada! Entrando...';
    pararLoginFacial();

    const { error } = await sb.auth.signInWithPassword({ email, password: json.face_senha });
    if (error) throw error;

  } catch(e) {
    pararLoginFacial();
    if (msg) msg.textContent = 'Falha: ' + e.message;
    if (btnAb) btnAb.textContent = 'Entrar com rosto';
  }
}

function pararLoginFacial() {
  clearInterval(_faceLoginInterval);
  _faceLoginInterval = null;
  if (_faceLoginStream) {
    _faceLoginStream.getTracks().forEach(t => t.stop());
    _faceLoginStream = null;
  }
  const video = document.getElementById('faceLoginVideo');
  if (video) video.srcObject = null;
  const area = document.getElementById('faceLoginArea');
  if (area) area.style.display = 'none';
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

function pararWebcam() {
  if (_faceStream) { _faceStream.getTracks().forEach(t => t.stop()); _faceStream = null; }
  const video = document.getElementById('faceVideo');
  if (video) video.srcObject = null;
}

function setFaceMsg(txt, isError) {
  const el = document.getElementById('faceMsg');
  if (!el) return;
  el.textContent = txt;
  el.className   = 'auth-msg' + (txt ? (isError ? ' error' : ' success') : '');
}
