// ===========================================
// Funciones utilitarias globales
// ===========================================

// Obtiene un elemento del DOM por su id
window.$id = (id) => document.getElementById(id);

// Media exponencial para suavizar señales (filtro EMA)
window.ema = (prev, val, alpha) => 
  prev == null ? val : (prev * (1 - alpha) + val * alpha);

// Distancia euclidiana entre dos puntos (x,y)
window.dist = (a,b) => Math.hypot(a.x - b.x, a.y - b.y);

// Punto medio entre dos puntos
window.mid  = (a,b) => ({ x: (a.x + b.x)/2, y: (a.y + b.y)/2 });

// Promedio de dos puntos (similar a mid, alias)
window.avgP = (a,b) => ({ x: (a.x + b.x)/2, y: (a.y + b.y)/2 });


// ===========================================
// Índices de landmarks (MediaPipe FaceMesh)
// ===========================================
// Define qué puntos se usarán para ojos, boca y cejas
window.IDX = {
  L: { h:[33,133], v1:[159,145], v2:[160,144] },   // Ojo izquierdo
  R: { h:[362,263], v1:[386,374], v2:[385,380] },  // Ojo derecho
  M: { h:[78,308], v1:[13,14],   v2:[82,312]  },   // Boca
  LBrow:[70,105], RBrow:[300,334]                  // Cejas (izquierda y derecha)
};


// ===========================================
// Funciones de métricas faciales
// ===========================================

// EAR (Eye Aspect Ratio) — Relación entre alto y ancho de los ojos
window.EAR = (L) => {
  const eye = (E) => {
    const h = dist(L[E.h[0]], L[E.h[1]]); // distancia horizontal ojo
    const v = (dist(L[E.v1[0]], L[E.v1[1]]) + dist(L[E.v2[0]], L[E.v2[1]])) / 2; // promedio vertical
    return v / h; // Relación alto/ancho
  };
  return (eye(IDX.L) + eye(IDX.R)) / 2; // promedio de ambos ojos
};

// MAR (Mouth Aspect Ratio) — Relación entre alto y ancho de la boca
window.MAR = (L) => {
  const h = dist(L[IDX.M.h[0]], L[IDX.M.h[1]]); // ancho de la boca
  const v = (dist(L[IDX.M.v1[0]], L[IDX.M.v1[1]]) + dist(L[IDX.M.v2[0]], L[IDX.M.v2[1]])) / 2; // apertura
  return v / h;
};

// BROW (Eyebrow Ratio) — Relación entre cejas y centro de ojos
window.BROW = (L) => {
  const lW = dist(L[IDX.L.h[0]], L[IDX.L.h[1]]);   // ancho ojo izq
  const rW = dist(L[IDX.R.h[0]], L[IDX.R.h[1]]);   // ancho ojo der

  const lC = mid(L[IDX.L.h[0]], L[IDX.L.h[1]]);    // centro ojo izq
  const rC = mid(L[IDX.R.h[0]], L[IDX.R.h[1]]);    // centro ojo der

  const lB = avgP(L[IDX.LBrow[0]], L[IDX.LBrow[1]]); // punto medio ceja izq
  const rB = avgP(L[IDX.RBrow[0]], L[IDX.RBrow[1]]); // punto medio ceja der

  const l  = (lC.y - lB.y) / lW; // distancia vertical relativa ceja-ojo izq
  const r  = (rC.y - rB.y) / rW; // distancia vertical relativa ceja-ojo der
  return (l + r) / 2;            // promedio entre cejas
};


// ===========================================
// Contadores de eventos (blink, mouth, brow)
// ===========================================

// Inicializa un contador con estado apagado
window.makeCounter = () => ({ 
  on:false,   // si está activo
  onF:0,      // frames consecutivos encendido
  offF:99,    // frames consecutivos apagado
  cool:0,     // frames de cooldown
  count:0     // número de veces detectado
});

// Actualiza contador en función del estado actual
window.updateCounter = (c, isOn, minOn, minOff, cooldown) => {
  if (c.cool > 0) c.cool--; // reduce cooldown

  if (isOn) {
    c.onF++;        // suma frame encendido
    c.offF = 0;     // resetea apagados
    // Si estaba apagado, pero cumple frames mínimos y sin cooldown → activar
    if (!c.on && c.onF >= minOn && c.cool === 0) c.on = true;
  } else {
    c.offF++;       // suma frame apagado
    c.onF = 0;      // resetea encendidos
    // Si estaba encendido y cumple frames apagado → apagar y contar evento
    if (c.on && c.offF >= minOff) { 
      c.on = false; 
      c.count++; 
      c.cool = cooldown; // aplica cooldown
    }
  }
};
