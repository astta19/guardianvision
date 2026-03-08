// ============================================================
// FACE LOGIN — cadastro facial (Passo 2)
// Dependências: face-api.js (carregado lazy), sb, currentUser,
//               salvarPerfilBanco (profile.js), showToast (ui.js)
// Modelos: /models/ na raiz do repositório
// ============================================================

const FACE_MODELS_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
const FACE_THRESHOLD  = 0.45; // distância máxima para match

let _faceApiLoaded   = false;
let _faceStream      = null;
let _faceDescriptors = []; // capturas acumuladas durante cadastro

// ── Carregar face-api.js lazy ────────────────────────────────
async function carregarFaceApi() {
  if (_faceApiLoaded) return true;
  return new Promise((resolve) => {
    // Se face-api já está no window (carregado anteriormente), pular o script
    if (window.faceapi) {
      _carregarModelos(resolve);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
    s.onload = () => _carregarModelos(resolve);
    s.onerror = (e) => {
      console.error('[face] falha ao carregar script face-api:', e);
      resolve(false);
    };
    document.head.appendChild(s);
  });
}

async function _carregarModelos(resolve) {
  try {
    console.log('[face] carregando modelos de:', FACE_MODELS_URL);
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODELS_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODELS_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(FACE_MODELS_URL),
    ]);
    console.log('[face] modelos carregados com sucesso');
    _faceApiLoaded = true;
    resolve(true);
  } catch(e) {
    console.error('[face] erro ao carregar modelos:', e.message, e);
    resolve(false);
  }
}

// ── Verificar status ao abrir o Perfil ──────────────────────
async function verificarStatusFace() {
  const statusEl      = document.getElementById('faceLoginStatus');
  const activateBtn   = document.getElementById('faceActivateBtn');
  const removeBtn     = document.getElementById('faceRemoveBtn');
  if (!statusEl) return;

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

// ── Iniciar cadastro — abre webcam ───────────────────────────
async function iniciarCadastroFace() {
  const msg       = document.getElementById('faceMsg');
  const area      = document.getElementById('faceWebcamArea');
  const captureMsg = document.getElementById('faceCaptureMsg');

  if (msg) { msg.className = 'auth-msg'; msg.textContent = ''; }

  // Carregar face-api
  setFaceMsg('Carregando modelos de reconhecimento...', false);
  const ok = await carregarFaceApi();
  if (!ok) { setFaceMsg('Erro ao carregar modelos. Verifique sua conexão.', true); return; }

  // Pedir acesso à câmera
  try {
    _faceStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
  } catch(e) {
    setFaceMsg('Permissão de câmera negada. Habilite nas configurações do navegador.', true);
    return;
  }

  const video = document.getElementById('faceVideo');
  video.srcObject = _faceStream;
  await video.play();

  _faceDescriptors = [];
  if (area) area.style.display = 'flex';
  if (captureMsg) captureMsg.textContent = 'Posicione seu rosto no centro e clique em Capturar (3x).';
  document.getElementById('faceActivateBtn').style.display = 'none';
  setFaceMsg('', false);
}

// ── Capturar frame e extrair descritor ──────────────────────
async function capturarFace() {
  const video      = document.getElementById('faceVideo');
  const captureMsg = document.getElementById('faceCaptureMsg');
  const btn        = document.getElementById('faceCaptureBtn');

  btn.disabled = true;
  if (captureMsg) captureMsg.textContent = 'Detectando rosto...';

  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });

  const result = await faceapi
    .detectSingleFace(video, opts)
    .withFaceLandmarks(true)
    .withFaceDescriptor();

  if (!result) {
    if (captureMsg) captureMsg.textContent = '⚠ Rosto não detectado. Ajuste a iluminação e tente novamente.';
    btn.disabled = false;
    return;
  }

  _faceDescriptors.push(Array.from(result.descriptor));
  const restantes = 3 - _faceDescriptors.length;

  if (restantes > 0) {
    if (captureMsg) captureMsg.textContent = `✓ Captura ${_faceDescriptors.length}/3 — ${restantes} restante(s). Mova levemente a cabeça.`;
    btn.disabled = false;
    return;
  }

  // 3 capturas — calcular descritor médio e salvar
  if (captureMsg) captureMsg.textContent = 'Salvando...';
  await salvarDescriptorFace();
}

// ── Calcular média e salvar no banco ────────────────────────
async function salvarDescriptorFace() {
  const captureMsg = document.getElementById('faceCaptureMsg');

  // Média dos 3 descritores (128 valores cada)
  const media = new Array(128).fill(0).map((_, i) =>
    _faceDescriptors.reduce((sum, d) => sum + d[i], 0) / _faceDescriptors.length
  );

  // Gerar face_senha aleatória para autenticação Supabase
  const faceSenha = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  try {
    // Salvar descritor e senha no perfil
    const ok = await salvarPerfilBanco({
      face_descriptor: media,
      face_senha: faceSenha
    });

    if (!ok) throw new Error('Falha ao salvar no banco');

    // Atualizar senha do usuário no Supabase Auth para a face_senha
    const { error } = await sb.auth.updateUser({ password: faceSenha });
    if (error) throw error;

    pararWebcam();
    document.getElementById('faceWebcamArea').style.display = 'none';
    document.getElementById('faceActivateBtn').style.display = 'none';
    document.getElementById('faceRemoveBtn').style.display   = 'inline-flex';
    document.getElementById('faceLoginStatus').innerHTML = '<span style="color:#16a34a">✓ Login facial ativado</span>';
    setFaceMsg('Login facial cadastrado com sucesso!', false);

  } catch(e) {
    if (captureMsg) captureMsg.textContent = '';
    setFaceMsg('Erro ao salvar: ' + e.message, true);
    document.getElementById('faceCaptureBtn').disabled = false;
  }
}

// ── Remover login facial ─────────────────────────────────────
async function removerFace() {
  if (!confirm('Remover o login facial? Você voltará a usar apenas e-mail e senha.')) return;
  try {
    await salvarPerfilBanco({ face_descriptor: null, face_senha: null });
    document.getElementById('faceLoginStatus').textContent = 'Login facial não configurado.';
    document.getElementById('faceActivateBtn').style.display = 'inline-flex';
    document.getElementById('faceRemoveBtn').style.display   = 'none';
    setFaceMsg('Login facial removido.', false);
  } catch(e) {
    setFaceMsg('Erro ao remover: ' + e.message, true);
  }
}

// ── Cancelar cadastro ────────────────────────────────────────
function cancelarCadastroFace() {
  pararWebcam();
  document.getElementById('faceWebcamArea').style.display    = 'none';
  document.getElementById('faceActivateBtn').style.display   = 'inline-flex';
  document.getElementById('faceCaptureMsg').textContent      = '';
  setFaceMsg('', false);
  _faceDescriptors = [];
}

// ── Helpers ──────────────────────────────────────────────────
function pararWebcam() {
  if (_faceStream) {
    _faceStream.getTracks().forEach(t => t.stop());
    _faceStream = null;
  }
  const video = document.getElementById('faceVideo');
  if (video) video.srcObject = null;
}

function setFaceMsg(txt, isError) {
  const el = document.getElementById('faceMsg');
  if (!el) return;
  el.textContent = txt;
  el.className   = 'auth-msg' + (txt ? (isError ? ' error' : ' success') : '');
}
