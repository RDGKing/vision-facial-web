// ===============================
// Referencias a elementos del DOM
// ===============================
const v = $id('video');          // Elemento <video> donde se muestra la cámara
const overlay = $id('overlay');  // Canvas que se dibuja encima del video
const octx = overlay.getContext('2d'); // Contexto 2D del canvas
const out = $id('out');          // Contenedor de salida (texto/estadísticas)

let videoReady = false;          // Bandera: indica si el video ya está listo
let started = false;             // Bandera: indica si el sistema ya inició

// =====================================
// Configuración de parámetros principales
// =====================================
const cfg = { 
  blinkDelta: 0.06,   // Sensibilidad de parpadeo
  mouthDelta: 0.09,   // Sensibilidad de apertura de boca
  browDelta: 0.08,    // Sensibilidad de cejas
  minOn: 3,           // Frames mínimos "encendido" para contar un evento
  minOff: 2,          // Frames mínimos "apagado" para reiniciar
  cooldown: 8         // Frames de enfriamiento entre eventos
};

// ================================
// Contadores para cada expresión
// ================================
const C = { 
  blink: makeCounter(), 
  mouth: makeCounter(), 
  brow: makeCounter() 
};

// Línea base (valores de referencia durante calibración)
let base = { EAR:null, MAR:null, BROW:null };

// Valores suavizados con media exponencial (para evitar ruido)
let smooth = { EAR:null, MAR:null, BROW:null };

// ================================
// Variables de calibración
// ================================
let calibrating = true;          // Estado: calibrando
let calibFrames = 0;             // Número de frames procesados en calibración
let calibTarget = 60;            // Frames necesarios para calibrar (~2s)

// ================================
// Ajuste de resolución del canvas
// ================================
let lastCSSW = 0, lastCSSH = 0, lastDPR = 0;
function ensureOverlayResolution() {
  const rect = v.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(rect.width));   // Ancho CSS
  const cssH = Math.max(1, Math.round(rect.height));  // Alto CSS
  const dpr  = Math.max(1, Math.round(window.devicePixelRatio || 1)); // Escala de pantalla

  // Si cambia tamaño o DPI, actualiza el canvas
  if (cssW !== lastCSSW || cssH !== lastCSSH || dpr !== lastDPR) {
    lastCSSW = cssW; lastCSSH = cssH; lastDPR = dpr;
    overlay.width  = cssW * dpr;
    overlay.height = cssH * dpr;
    octx.setTransform(dpr, 0, 0, dpr, 0, 0); // Ajusta transformaciones
  }
  return { cssW, cssH };
}

// ================================
// Actualiza la interfaz de usuario
// ================================
function refreshUI(e,m,b){
  $id('mEAR').textContent  = `${(e??0).toFixed(3)} / ${(base.EAR??0).toFixed(3)}`;
  $id('mMAR').textContent  = `${(m??0).toFixed(3)} / ${(base.MAR??0).toFixed(3)}`;
  $id('mBROW').textContent = `${(b??0).toFixed(3)} / ${(base.BROW??0).toFixed(3)}`;
  $id('cBlinks').textContent = C.blink.count;
  $id('cMouth').textContent  = C.mouth.count;
  $id('cBrow').textContent   = C.brow.count;
}

// ================================
// Configura controles de UI
// ================================
function attachControls(){
  // Sliders para sensibilidad de parpadeo, boca y cejas
  $id('blinkRange').addEventListener('input', e=>{
    cfg.blinkDelta = +e.target.value; 
    $id('blinkVal').textContent = cfg.blinkDelta.toFixed(3);
  });
  $id('mouthRange').addEventListener('input', e=>{
    cfg.mouthDelta = +e.target.value; 
    $id('mouthVal').textContent = cfg.mouthDelta.toFixed(3);
  });
  $id('browRange').addEventListener('input', e=>{
    cfg.browDelta = +e.target.value; 
    $id('browVal').textContent  = cfg.browDelta.toFixed(3);
  });

  // Botón para resetear contadores
  $id('resetBtn').addEventListener('click', ()=>{
    Object.assign(C.blink, makeCounter());
    Object.assign(C.mouth, makeCounter());
    Object.assign(C.brow,  makeCounter());
    refreshUI(smooth.EAR, smooth.MAR, smooth.BROW);
  });

  // Botón para recalibrar
  $id('recalBtn').addEventListener('click', ()=>{
    base={EAR:null,MAR:null,BROW:null};
    calibrating=true; calibFrames=0;
    $id('calibMsg').textContent='Calibrando línea base…';
  });

  // Valores iniciales visibles en la UI
  $id('blinkVal').textContent = cfg.blinkDelta.toFixed(3);
  $id('mouthVal').textContent = cfg.mouthDelta.toFixed(3);
  $id('browVal').textContent  = cfg.browDelta.toFixed(3);
}

// ================================
// Inicia la cámara del usuario
// ================================
async function startVideo() {
  // Aviso si no es HTTPS (requisito de getUserMedia)
  if (location.protocol !== 'https:' &&
      location.hostname !== 'localhost' &&
      location.hostname !== '127.0.0.1') {
    console.warn('getUserMedia requiere https o localhost/127.0.0.1');
  }

  // Solicita cámara (ideal 960x540)
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width:{ideal:960}, height:{ideal:540} },
    audio: false
  });

  // Asigna el stream al video
  v.srcObject = stream;
  await new Promise(r => { v.onloadedmetadata = ()=>{ v.play(); r(); }; });
  videoReady = true;

  // Ajusta tamaño del overlay al redimensionar
  window.addEventListener('resize', ensureOverlayResolution);
  ensureOverlayResolution();
}

// ================================
// Procesamiento de resultados (FaceMesh)
// ================================
let faceMesh = null;
let camera = null;

function onResults(res){
  const { cssW, cssH } = ensureOverlayResolution();
  octx.clearRect(0, 0, cssW, cssH);

  // Si no hay rostros, limpiar y salir
  if (!res.multiFaceLandmarks || !res.multiFaceLandmarks.length) {
    refreshUI(null,null,null);
    return;
  }

  // Obtiene landmarks del rostro principal
  const L = res.multiFaceLandmarks[0];

  // Calcula métricas: EAR (ojos), MAR (boca), BROW (cejas)
  let ear  = EAR(L), mar = MAR(L), brow = BROW(L);

  // Suaviza con media exponencial
  smooth.EAR  = ema(smooth.EAR,  ear,  0.35);
  smooth.MAR  = ema(smooth.MAR,  mar,  0.35);
  smooth.BROW = ema(smooth.BROW, brow, 0.35);

  // ========================
  // Fase de calibración
  // ========================
  if (calibrating) {
    const a = 0.1;
    base.EAR  = ema(base.EAR,  smooth.EAR,  a);
    base.MAR  = ema(base.MAR,  smooth.MAR,  a);
    base.BROW = ema(base.BROW, smooth.BROW, a);
    calibFrames++;

    $id('calibMsg').textContent = `Calibrando… ${Math.min(calibFrames,calibTarget)}/${calibTarget}`;
    if (calibFrames >= calibTarget) { 
      calibrating = false; 
      $id('calibMsg').textContent = 'Listo'; 
    }
  }

  // ========================
  // Detección de eventos
  // ========================
  if (base.EAR && base.MAR && base.BROW) {
    const isBlink = smooth.EAR  < (base.EAR  - cfg.blinkDelta);
    const isMouth = smooth.MAR  > (base.MAR  + cfg.mouthDelta);
    const isBrow  = smooth.BROW > (base.BROW + cfg.browDelta);

    updateCounter(C.blink, isBlink, cfg.minOn,     cfg.minOff,     cfg.cooldown);
    updateCounter(C.mouth, isMouth, cfg.minOn,     cfg.minOff,     cfg.cooldown);
    updateCounter(C.brow,  isBrow,  cfg.minOn + 1, cfg.minOff + 1, cfg.cooldown + 2);
  }

  // Refresca métricas en UI
  refreshUI(smooth.EAR, smooth.MAR, smooth.BROW);

  // ========================
  // Modo debug (dibuja puntos/lineas)
  // ========================
  if ($id('debugToggle').checked) {
    octx.save();
    octx.strokeStyle='rgba(0,200,255,.9)'; octx.lineWidth=2;

    const toX = x => x * cssW;
    const toY = y => y * cssH;

    // Función para dibujar puntos
    const drawPt=(p,r=2)=>{
      octx.beginPath();
      octx.arc(toX(p.x), toY(p.y), r, 0, Math.PI*2);
      octx.stroke();
    };

    // Dibuja landmarks clave
    [
      IDX.L.h[0],IDX.L.h[1],IDX.L.v1[0],IDX.L.v1[1],IDX.L.v2[0],IDX.L.v2[1],
      IDX.R.h[0],IDX.R.h[1],IDX.R.v1[0],IDX.R.v1[1],IDX.R.v2[0],IDX.R.v2[1],
      IDX.M.h[0],IDX.M.h[1],IDX.M.v1[0],IDX.M.v1[1],IDX.M.v2[0],IDX.M.v2[1],
      IDX.LBrow[0],IDX.LBrow[1],IDX.RBrow[0],IDX.RBrow[1]
    ].forEach(i=>drawPt(L[i]));

    // Función para dibujar líneas
    const line=(a,b,c='rgba(0,200,255,.6)')=>{
      octx.strokeStyle=c; octx.beginPath();
      octx.moveTo(toX(L[a].x), toY(L[a].y));
      octx.lineTo(toX(L[b].x), toY(L[b].y));
      octx.stroke();
    };

    // Líneas de ojos y boca
    line(IDX.L.h[0],IDX.L.h[1]);
    line(IDX.R.h[0],IDX.R.h[1]);
    line(IDX.M.h[0],IDX.M.h[1],'rgba(0,255,160,.6)');
    octx.restore();
  }
}

// ================================
// Inicialización completa
// ================================
async function initAll(){
  attachControls(); // Configura sliders y botones
  await startVideo(); // Inicia cámara
  // Configura FaceMesh de MediaPipe
  faceMesh = new FaceMesh({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}` });
  faceMesh.setOptions({ 
    maxNumFaces:1, 
    refineLandmarks:true, 
    minDetectionConfidence:0.5, 
    minTrackingConfidence:0.5 
  });
  faceMesh.onResults(onResults);

  // Cámara virtual de MediaPipe
  const camera = new Camera(v, { onFrame: async()=>{ await faceMesh.send({ image:v }); } });
  camera.start();
}

// ================================
// Ejecuta initAll() al cargar página
// ================================
window.addEventListener('load', initAll);
