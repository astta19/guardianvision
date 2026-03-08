// face.js v4 — Luxand.cloud, zero MediaPipe
// Modal login  → abrirModalFace() / fecharModalFace()
// Modal cadastro → iniciarCadastroFace() / _fecharCadModal()

// ════════════════════════════════════════════════════════════
// MODAL DE LOGIN FACIAL
// ════════════════════════════════════════════════════════════

let _loginStream      = null;
let _loginAtivo       = false;
let _loginProcessando = false;

function abrirModalFace() {
  document.getElementById('faceModal').style.display = 'flex';
  document.getElementById('faceModalEmail').value    = '';
  document.getElementById('faceModalCamWrap').style.display = 'none';
  _lSetStatus('Digite seu e-mail e clique em Abrir câmera.');
  _lSetBtn('Abrir câmera', true);
  _lSetBorder('');
  _loginAtivo = false;
}

function fecharModalFace() {
  _pararLoginCam();
  document.getElementById('faceModal').style.display = 'none';
}

async function faceModalAcao() {
  if (_loginAtivo) _capturarEVerificar();
  else             _abrirCamLogin();
}

async function _abrirCamLogin() {
  const email = document.getElementById('faceModalEmail').value.trim();
  if (!email || !email.includes('@')) { _lSetStatus('⚠ Informe um e-mail válido.'); return; }

  _lSetStatus('Acessando câmera...'); _lSetBtn('Aguarde...', false);

  try {
    _loginStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
    });
  } catch {
    _lSetStatus('⚠ Câmera bloqueada. Habilite o acesso nas configurações do navegador.');
    _lSetBtn('Abrir câmera', true); return;
  }

  const v = document.getElementById('faceModalVideo');
  v.srcObject = _loginStream;
  await v.play().catch(() => {});
  document.getElementById('faceModalCamWrap').style.display = 'block';
  _loginAtivo = true; _loginProcessando = false;
  _lSetBtn('Capturar e verificar', true);
  _lSetStatus('Posicione seu rosto e aguarde...');
  setTimeout(() => { if (_loginAtivo && !_loginProcessando) _capturarEVerificar(); }, 2000);
}

async function _capturarEVerificar() {
  if (_loginProcessando) return;
  _loginProcessando = true;

  const video = document.getElementById('faceModalVideo');
  const email = document.getElementById('faceModalEmail').value.trim();
  if (!video.videoWidth) { _lSetStatus('⚠ Câmera ainda iniciando.'); _loginProcessando = false; return; }

  _lSetStatus('Verificando...'); _lSetBtn('Aguarde...', false); _lSetBorder('');

  const blob = _frameToBlob(video);
  const form = new FormData();
  form.append('action', 'verify');
  form.append('email', email);
  form.append('photo', blob, 'face.jpg');

  try {
    const res  = await fetch('/api/face-auth', { method: 'POST', body: form });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error);

    _lSetBorder('#16a34a');
    _lSetStatus('✓ Identidade confirmada! Entrando...');
    _pararLoginCam();

    setTimeout(async () => {
      fecharModalFace();
      const { error } = await sb.auth.signInWithPassword({ email, password: json.face_senha });
      if (error) {
        const el = document.getElementById('loginMsg');
        if (el) { el.textContent = 'Erro: ' + error.message; el.className = 'auth-msg error'; }
      }
    }, 700);

  } catch (e) {
    _lSetBorder('#dc2626');
    _lSetStatus('⚠ ' + e.message);
    _lSetBtn('Tentar novamente', true);
    _loginProcessando = false;
    setTimeout(() => { if (_loginAtivo && !_loginProcessando) _capturarEVerificar(); }, 2500);
  }
}

function _pararLoginCam() {
  _loginAtivo = false;
  if (_loginStream) { _loginStream.getTracks().forEach(t => t.stop()); _loginStream = null; }
  const v = document.getElementById('faceModalVideo');
  if (v) v.srcObject = null;
  document.getElementById('faceModalCamWrap').style.display = 'none';
  _lSetBtn('Abrir câmera', true);
}

function _lSetStatus(t) { const el = document.getElementById('faceModalStatus'); if (el) el.textContent = t; }
function _lSetBtn(t, on) {
  const b = document.getElementById('faceModalBtn');
  if (!b) return; b.textContent = t; b.disabled = !on; b.style.opacity = on ? '1' : '0.55';
}
function _lSetBorder(c) {
  const el = document.getElementById('faceModalOverlay');
  if (el) el.style.borderColor = c || 'transparent';
}

// ════════════════════════════════════════════════════════════
// MODAL DE CADASTRO FACIAL (Perfil)
// ════════════════════════════════════════════════════════════

let _cadStream      = null;
let _cadAtivo       = false;
let _cadProcessando = false;

function iniciarCadastroFace() {
  // Abre o modal de cadastro em vez de inline no perfil
  const modal = document.getElementById('faceCadModal');
  if (!modal) return;
  modal.style.display = 'flex';
  _cadAtivo = false; _cadProcessando = false;
  _cSetStatus('Clique em Abrir câmera para começar.');
  _cSetBtn('Abrir câmera', true);
  _cSetBorder('');
  document.getElementById('faceCadCamWrap').style.display = 'none';
}

function _fecharCadModal() {
  _pararCadCam();
  const modal = document.getElementById('faceCadModal');
  if (modal) modal.style.display = 'none';
}

async function _acaoCadModal() {
  if (_cadAtivo) _capturarECadastrar();
  else           _abrirCamCad();
}

async function _abrirCamCad() {
  _cSetStatus('Acessando câmera...'); _cSetBtn('Aguarde...', false);
  try {
    _cadStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
    });
  } catch {
    _cSetStatus('⚠ Câmera bloqueada. Habilite o acesso nas configurações.');
    _cSetBtn('Abrir câmera', true); return;
  }

  const v = document.getElementById('faceCadVideo');
  v.srcObject = _cadStream;
  await v.play().catch(() => {});
  document.getElementById('faceCadCamWrap').style.display = 'block';
  _cadAtivo = true; _cadProcessando = false;
  _cSetBtn('Capturar', true);
  _cSetStatus('Posicione seu rosto e clique em Capturar.');
}

async function _capturarECadastrar() {
  if (_cadProcessando) return;
  _cadProcessando = true;

  const video = document.getElementById('faceCadVideo');
  if (!video.videoWidth) { _cSetStatus('⚠ Câmera ainda iniciando.'); _cadProcessando = false; return; }

  _cSetStatus('Enviando para cadastro...'); _cSetBtn('Aguarde...', false);

  const blob      = _frameToBlob(video);
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

    const ok = await salvarPerfilBanco({ face_descriptor: json.person_uuid, face_senha: faceSenha });
    if (!ok) throw new Error('Falha ao salvar no banco');

    const { error } = await sb.auth.updateUser({ password: faceSenha });
    if (error) throw error;

    _cSetBorder('#16a34a');
    _cSetStatus('✓ Login facial ativado com sucesso!');
    _pararCadCam();

    setTimeout(() => {
      _fecharCadModal();
      // Atualiza status no perfil
      const statusEl = document.getElementById('faceLoginStatus');
      if (statusEl) statusEl.innerHTML = '<span style="color:#16a34a">✓ Login facial ativado</span>';
      const activateBtn = document.getElementById('faceActivateBtn');
      const removeBtn   = document.getElementById('faceRemoveBtn');
      if (activateBtn) activateBtn.style.display = 'none';
      if (removeBtn)   removeBtn.style.display   = 'inline-flex';
      setFaceMsg('Login facial ativado com sucesso!', false);
    }, 1200);

  } catch (e) {
    _cSetBorder('#dc2626');
    _cSetStatus('⚠ ' + e.message + '. Tente novamente.');
    _cSetBtn('Capturar', true);
    _cadProcessando = false;
  }
}

function _pararCadCam() {
  _cadAtivo = false;
  if (_cadStream) { _cadStream.getTracks().forEach(t => t.stop()); _cadStream = null; }
  const v = document.getElementById('faceCadVideo');
  if (v) v.srcObject = null;
}

function _cSetStatus(t) { const el = document.getElementById('faceCadStatus'); if (el) el.textContent = t; }
function _cSetBtn(t, on) {
  const b = document.getElementById('faceCadBtn');
  if (!b) return; b.textContent = t; b.disabled = !on; b.style.opacity = on ? '1' : '0.55';
}
function _cSetBorder(c) {
  const el = document.getElementById('faceCadOverlay');
  if (el) el.style.borderColor = c || 'transparent';
}

// ════════════════════════════════════════════════════════════
// REMOÇÃO FACIAL
// ════════════════════════════════════════════════════════════

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
    const statusEl = document.getElementById('faceLoginStatus');
    if (statusEl) statusEl.textContent = 'Login facial não configurado.';
    const activateBtn = document.getElementById('faceActivateBtn');
    const removeBtn   = document.getElementById('faceRemoveBtn');
    if (activateBtn) activateBtn.style.display = 'inline-flex';
    if (removeBtn)   removeBtn.style.display   = 'none';
    setFaceMsg('Login facial removido.', false);
  } catch (e) { setFaceMsg('Erro: ' + e.message, true); }
}

// ════════════════════════════════════════════════════════════
// STATUS NO PERFIL
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

function setFaceMsg(txt, isError) {
  const el = document.getElementById('faceMsg');
  if (!el) return;
  el.textContent = txt;
  el.className   = 'auth-msg' + (txt ? (isError ? ' error' : ' success') : '');
}

// ════════════════════════════════════════════════════════════
// UTILITÁRIO: capturar frame como Blob síncrono
// ════════════════════════════════════════════════════════════

function _frameToBlob(video) {
  const c = document.createElement('canvas');
  c.width  = video.videoWidth  || 640;
  c.height = video.videoHeight || 480;
  c.getContext('2d').drawImage(video, 0, 0);
  const dataUrl = c.toDataURL('image/jpeg', 0.88);
  const bin = atob(dataUrl.split(',')[1]);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: 'image/jpeg' });
}
