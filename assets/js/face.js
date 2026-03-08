// face.js v3 — Luxand.cloud, zero MediaPipe
// Cadastro: Perfil → captura frame → POST /api/face-auth (enroll)
// Login:    Modal  → captura frame → POST /api/face-auth (verify)

// ════════════════════════════════════════════════════════════
// MODAL DE LOGIN FACIAL
// ════════════════════════════════════════════════════════════

let _loginStream     = null;
let _loginAtivo      = false;
let _loginProcessando = false;

function abrirModalFace() {
  document.getElementById('faceModal').style.display = 'flex';
  document.getElementById('faceModalEmail').value    = '';
  document.getElementById('faceModalCamWrap').style.display = 'none';
  _setStatus('Digite seu e-mail e clique em Abrir câmera.');
  _setBtn('Abrir câmera', true);
  _setBorder('');
  _loginAtivo = false;
}

function fecharModalFace() {
  _pararLogin();
  document.getElementById('faceModal').style.display = 'none';
}

async function faceModalAcao() {
  if (_loginAtivo) {
    // câmera já aberta: capturar agora
    _capturarEVerificar();
  } else {
    _abrirCamLogin();
  }
}

async function _abrirCamLogin() {
  const email = document.getElementById('faceModalEmail').value.trim();
  if (!email || !email.includes('@')) {
    _setStatus('⚠ Informe um e-mail válido.'); return;
  }

  _setStatus('Acessando câmera...');
  _setBtn('Aguarde...', false);

  try {
    _loginStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
    });
  } catch(e) {
    _setStatus('⚠ Câmera bloqueada. Habilite o acesso nas configurações.');
    _setBtn('Abrir câmera', true);
    return;
  }

  const video = document.getElementById('faceModalVideo');
  video.srcObject = _loginStream;
  await video.play().catch(() => {});

  document.getElementById('faceModalCamWrap').style.display = 'block';
  _loginAtivo      = true;
  _loginProcessando = false;
  _setBtn('Capturar e verificar', true);
  _setStatus('Posicione seu rosto e clique no botão.');

  // auto-captura após 2s
  setTimeout(() => { if (_loginAtivo && !_loginProcessando) _capturarEVerificar(); }, 2000);
}

async function _capturarEVerificar() {
  if (_loginProcessando) return;
  _loginProcessando = true;

  const video = document.getElementById('faceModalVideo');
  const email = document.getElementById('faceModalEmail').value.trim();

  if (!video.videoWidth) {
    _setStatus('⚠ Câmera ainda iniciando. Tente novamente.');
    _loginProcessando = false;
    return;
  }

  _setStatus('Verificando...');
  _setBtn('Aguarde...', false);
  _setBorder('');

  const blob = _capturarFrame(video);

  const form = new FormData();
  form.append('action', 'verify');
  form.append('email',  email);
  form.append('photo',  blob, 'face.jpg');

  try {
    const res  = await fetch('/api/face-auth', { method: 'POST', body: form });
    const json = await res.json();

    if (!res.ok || json.error) throw new Error(json.error);

    _setBorder('#16a34a');
    _setStatus('✓ Identidade confirmada! Entrando...');
    _pararLogin();

    setTimeout(async () => {
      fecharModalFace();
      const { error } = await sb.auth.signInWithPassword({ email, password: json.face_senha });
      if (error) {
        const el = document.getElementById('loginMsg');
        if (el) { el.textContent = 'Erro: ' + error.message; el.className = 'auth-msg error'; }
      }
    }, 700);

  } catch(e) {
    _setBorder('#dc2626');
    _setStatus('⚠ ' + e.message);
    _setBtn('Tentar novamente', true);
    _loginProcessando = false;
    // nova tentativa automática
    setTimeout(() => { if (_loginAtivo && !_loginProcessando) _capturarEVerificar(); }, 2500);
  }
}

function _capturarFrame(video) {
  const c = document.createElement('canvas');
  c.width  = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  let blob;
  c.toBlob(b => { blob = b; }, 'image/jpeg', 0.88);
  // toBlob é async mas precisamos sync aqui — usar dataURL como fallback
  const dataUrl = c.toDataURL('image/jpeg', 0.88);
  const arr = dataUrl.split(',')[1];
  const bin = atob(arr);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: 'image/jpeg' });
}

function _pararLogin() {
  _loginAtivo = false;
  if (_loginStream) { _loginStream.getTracks().forEach(t => t.stop()); _loginStream = null; }
  const v = document.getElementById('faceModalVideo');
  if (v) v.srcObject = null;
  document.getElementById('faceModalCamWrap').style.display = 'none';
  _setBtn('Abrir câmera', true);
}

function _setStatus(txt) {
  const el = document.getElementById('faceModalStatus');
  if (el) el.textContent = txt;
}

function _setBtn(txt, on) {
  const b = document.getElementById('faceModalBtn');
  if (!b) return;
  b.textContent  = txt;
  b.disabled     = !on;
  b.style.opacity = on ? '1' : '0.55';
}

function _setBorder(color) {
  const el = document.getElementById('faceModalOverlay');
  if (el) el.style.borderColor = color || 'transparent';
}

// ════════════════════════════════════════════════════════════
// CADASTRO FACIAL — Perfil do usuário
// ════════════════════════════════════════════════════════════

let _cadStream = null;

async function verificarStatusFace() {
  const statusEl    = document.getElementById('faceLoginStatus');
  const activateBtn = document.getElementById('faceActivateBtn');
  const removeBtn   = document.getElementById('faceRemoveBtn');
  if (!statusEl || !currentUser) return;
  try {
    const { data } = await sb
      .from('perfis_usuarios').select('face_descriptor')
      .eq('user_id', currentUser.id).maybeSingle();
    const ativo = !!(data?.face_descriptor);
    statusEl.innerHTML  = ativo
      ? '<span style="color:#16a34a">✓ Login facial ativado</span>'
      : 'Login facial não configurado.';
    if (activateBtn) activateBtn.style.display = ativo ? 'none'        : 'inline-flex';
    if (removeBtn)   removeBtn.style.display   = ativo ? 'inline-flex' : 'none';
  } catch {
    if (statusEl) statusEl.textContent = 'Não foi possível verificar.';
  }
}

async function iniciarCadastroFace() {
  setFaceMsg('Acessando câmera...', false);
  try {
    _cadStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
    });
  } catch {
    setFaceMsg('Câmera negada. Habilite nas configurações do navegador.', true); return;
  }
  const video = document.getElementById('faceVideo');
  video.srcObject = _cadStream;
  await video.play().catch(() => {});

  document.getElementById('faceWebcamArea').style.display  = 'flex';
  document.getElementById('faceActivateBtn').style.display = 'none';
  document.getElementById('faceCaptureMsg').textContent    = 'Posicione seu rosto centralizado e clique em Capturar.';
  setFaceMsg('', false);
}

async function capturarFace() {
  const video      = document.getElementById('faceVideo');
  const captureMsg = document.getElementById('faceCaptureMsg');
  const btn        = document.getElementById('faceCaptureBtn');

  if (!video.videoWidth) {
    captureMsg.textContent = '⚠ Câmera ainda inicializando. Aguarde e tente novamente.';
    return;
  }

  btn.disabled           = true;
  captureMsg.textContent = 'Enviando para cadastro...';

  const blob      = _capturarFrame(video);
  const faceSenha = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const form = new FormData();
  form.append('action',     'enroll');
  form.append('user_id',    currentUser.id);
  form.append('face_senha', faceSenha);
  form.append('photo',      blob, 'face.jpg');

  try {
    const res  = await fetch('/api/face-auth', { method: 'POST', body: form });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || 'Erro no cadastro');

    // Salvar UUID do Luxand + face_senha
    const ok = await salvarPerfilBanco({ face_descriptor: json.person_uuid, face_senha: faceSenha });
    if (!ok) throw new Error('Falha ao salvar no banco');

    const { error } = await sb.auth.updateUser({ password: faceSenha });
    if (error) throw error;

    _pararCamCad();
    document.getElementById('faceWebcamArea').style.display = 'none';
    document.getElementById('faceRemoveBtn').style.display  = 'inline-flex';
    document.getElementById('faceLoginStatus').innerHTML    = '<span style="color:#16a34a">✓ Login facial ativado</span>';
    setFaceMsg('Login facial ativado com sucesso!', false);

  } catch(e) {
    captureMsg.textContent = '⚠ ' + e.message + '. Tente novamente.';
    btn.disabled = false;
  }
}

async function removerFace() {
  if (!confirm('Remover login facial?')) return;
  try {
    const { data } = await sb
      .from('perfis_usuarios').select('face_descriptor')
      .eq('user_id', currentUser.id).maybeSingle();

    if (data?.face_descriptor) {
      await fetch('/api/face-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', person_uuid: data.face_descriptor })
      });
    }
    await salvarPerfilBanco({ face_descriptor: null, face_senha: null });
    document.getElementById('faceLoginStatus').textContent   = 'Login facial não configurado.';
    document.getElementById('faceActivateBtn').style.display = 'inline-flex';
    document.getElementById('faceRemoveBtn').style.display   = 'none';
    setFaceMsg('Login facial removido.', false);
  } catch(e) { setFaceMsg('Erro: ' + e.message, true); }
}

function cancelarCadastroFace() {
  _pararCamCad();
  document.getElementById('faceWebcamArea').style.display   = 'none';
  document.getElementById('faceActivateBtn').style.display  = 'inline-flex';
  document.getElementById('faceCaptureMsg').textContent     = '';
  setFaceMsg('', false);
}

function _pararCamCad() {
  if (_cadStream) { _cadStream.getTracks().forEach(t => t.stop()); _cadStream = null; }
  const v = document.getElementById('faceVideo');
  if (v) v.srcObject = null;
}

function setFaceMsg(txt, isError) {
  const el = document.getElementById('faceMsg');
  if (!el) return;
  el.textContent = txt;
  el.className   = 'auth-msg' + (txt ? (isError ? ' error' : ' success') : '');
}
