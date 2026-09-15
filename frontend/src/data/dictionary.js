const I = {
  es: {
    tbTitle: "VoxReady — Wireframe (prototipo)", palette: "Paleta", brandP: "Wireframe v0.4 · low-fi",
    theme: "Modo claro / oscuro",
    login: {
      title: "Inicia sesión en VoxReady", sub: "Selecciona un usuario de prueba o escribe tus credenciales.",
      emailL: "Correo electrónico", emailPh: "tu@empresa.com", passL: "Contraseña", passPh: "••••••••",
      signIn: "Iniciar sesión", err: "Correo no reconocido. Usa uno de los usuarios de prueba.",
      testL: "Usuarios de prueba", logout: "Cerrar sesión"
    },
    roles: ["Usuario final (vocero)", "Admin del cliente", "Configurador maestro"],
    nav: ["Inicio / mis prácticas", "Elegir escenario", "Consentimiento + check técnico", "Sesión de práctica (50/50)", "Analizando…", "Informe tipo coach", "Mi progreso", "Panel del cliente", "Editor de tema", "Política de retención", "Panel maestro", "Editor de rúbrica / patrón", "Cola de etiquetado"],
    practice: "Practicar", start: "Empezar", openLesson: "Abrir lección", back: "← Volver", noteUX: "Nota UX:",
    L: {
      u1: {
        crumbs: "Usuario final", title: "Inicio / mis prácticas", sub: "Lo primero que ve el vocero. La acción dominante es practicar; el progreso lo motiva a repetir.",
        s1: "Sesiones completadas", s2: "Última puntuación global", s3: "Área a mejorar", s3v: "Nivel de empatía",
        sugT: "Escenarios sugeridos para ti", sugHelp: "Recomendados según tu área más débil. Al elegir uno pasas al consentimiento y la comprobación técnica, y luego a la sesión.",
        c1n: "Retiro de producto", c1c: "Eres el vocero ante prensa tras detectar un defecto. Entrevista de 8 preguntas.", c1m: ["≈ 6 min", "Intermedio", "Dirección"],
        c2n: "Incidente de seguridad", c2c: "Filtración de datos de clientes. Debes informar sin alarmar.", c2m: ["≈ 5 min", "Difícil", "Planta"],
        microT: "Microlecciones (teoría + ejemplo)", microMeta: "3–5 min · abre la lección",
        m1: "Mensajes puente", m2: "Preguntas hostiles", m3: "Lenguaje no verbal",
        note: "El botón “Practicar” es la acción dominante y lleva al flujo de sesión. Las microlecciones preparan al vocero entre prácticas y se recomiendan según su área más floja."
      },
      u2: {
        crumbs: "Usuario final › Practicar", title: "Elegir escenario", sub: "Catálogo de temas que el admin configuró para el público interno del usuario.",
        filters: ["Todos", "Sanitaria", "Reputacional", "Operativa"], search: "Buscar escenario…", img: "Imagen / icono",
        dir: "Dirección", plant: "Planta", start: "Empezar", note: "Cada tarjeta marca el público interno para que el usuario vea solo lo pertinente a su rol."
      },
      u3: {
        crumbs: "Usuario final › Practicar", title: "Consentimiento + comprobación técnica", sub: "Paso obligatorio antes de grabar. Bloquea el inicio hasta consentir y validar cámara/micrófono.",
        camL: "Vista previa de cámara", camOk: "cámara OK", mic: "Micrófono", micOk: "Detectado", light: "Iluminación", lightW: "Mejorable",
        consentL: "Consentimiento de grabación (biométrico)", legal: "Texto legal: se grabará su voz e imagen para evaluar su desempeño. Datos tratados como biométricos…",
        chk1: "Acepto la grabación y el tratamiento según la política de retención de mi organización.", chk2: "Entiendo que puedo solicitar el borrado de mis grabaciones.",
        beginBtn: "Comenzar sesión", cancel: "Cancelar", sesLang: "Marca ambas casillas para habilitar el botón.",
        note: "“Comenzar” permanece deshabilitado hasta marcar ambos consentimientos. El check técnico evita grabaciones inservibles."
      },
      u4: {
        crumbs: "Usuario final › Sesión en curso", title: "Sesión de práctica — vista dividida 50/50", sub: "Pantalla central. Entrevistador IA y self-view del mismo tamaño, lado a lado.",
        interviewer: "Entrevistador IA", interviewerV: "Avatar / video del entrevistador", selfV: "Self-view del usuario",
        qL: "Pregunta actual (subtítulo en vivo)", qEx: "¿Por qué su empresa tardó tres semanas en avisar a los clientes del defecto, sabiendo que ya había reportes de fallas?", pause: "⏸ Pausar", repeat: "Repetir pregunta", qn: "Pregunta 3 de 8", finish: "Finalizar entrevista",
        note: "Nada se evalúa en pantalla durante la sesión (análisis asíncrono). Solo subtítulo en vivo + controles mínimos."
      },
      u5: {
        crumbs: "Usuario final", title: "Analizando tu sesión…", sub: "Transición mientras corren los tres pipelines (voz, imagen, contenido) y la fusión.",
        head: "Estamos preparando tu informe", small: "Suele tardar unos segundos.",
        p1: "Transcribiendo y evaluando contenido", p2: "Analizando tono de voz", p3: "Analizando expresión y gesto", p4: "Integrando empatía (fusión)",
        note: "Mostrar los pasos reduce la ansiedad de la espera y comunica que la evaluación es multimodal."
      },
      u6: {
        crumbs: "Usuario final › Informe", title: "Informe tipo coach", sub: "Narrativa coach primero; los puntajes por área quedan como apoyo visual debajo.",
        globalL: "Evaluación global", scenLine: "Escenario: retiro de producto · 24 jun 2026", good: "Lo que hiciste bien", improve: "Qué mejorar la próxima vez",
        quote: "“Sonaste firme al dar los datos, pero al hablar del cliente afectado evitaste la mirada — eso restó empatía percibida.” (observación de ejemplo, señal cruzada)",
        detail: "Detalle por área", areas: ["Expresión", "Tono de voz", "Coherencia", "Nivel de empatía"], watch: "▷ Ver mi grabación", redo: "Repetir este escenario",
        note: "Primero el relato accionable (cómo mejorar), luego los números. La línea de tiempo con marcas por minuto queda para fase 2."
      },
      u7: {
        crumbs: "Usuario final", title: "Mi progreso", sub: "Evolución de las cuatro áreas, recomendaciones y agenda de tu próxima sesión.",
        trendL: "Tendencia de las 4 áreas (últimas 5 sesiones)", series: ["Expresión", "Tono de voz", "Coherencia", "Empatía"],
        tblTitle: "Avance por área", tblCols: ["Área", "Actual", "Cambio"],
        recoTitle: "Recomendaciones para ti",
        recos: [{ t: "Trabaja el contacto visual", d: "Tu empatía baja cuando desvías la mirada. Practica mantenerla en momentos difíciles." },
        { t: "Reduce muletillas", d: "Detectamos 14 “eh/este” por sesión. La microlección de dicción ayuda." },
        { t: "Refuerza el mensaje puente", d: "Te cuesta volver a tu mensaje clave tras una pregunta trampa." }],
        calTitle: "Programa tu próxima sesión", calHelp: "Elige un día en el calendario para agendar tu práctica.",
        calBtn: "Confirmar", calNone: "sin fecha", nextLabel: "Próxima sesión:",
        months: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
        weekdays: ["L", "M", "X", "J", "V", "S", "D"],
        note: "El progreso convierte la práctica suelta en un plan: gráfico de tendencia, recomendaciones accionables y un calendario para mantener el hábito."
      },
      a1: {
        crumbs: "Admin del cliente", title: "Panel del cliente", sub: "El admin gestiona temas, usuarios y uso. No ve cómo se evalúa.",
        st: ["Temas activos", "Voceros", "Sesiones (mes)", "Global medio"], themesL: "Temas configurados", newT: "+ Nuevo tema",
        th: ["Tema", "Público interno", "Idiomas", "Retención", ""], edit: "Editar",
        rows: [["Retiro de producto", "Dirección", "ES, EN", "90 días"], ["Incidente de seguridad", "Planta", "ES", "Solo métricas"], ["Crisis reputacional", "Dirección", "ES, EN, PT", "30 días"]],
        note: "La tabla expone público interno y retención porque son las decisiones que el admin toca a diario."
      },
      a2: {
        crumbs: "Admin del cliente › Temas", title: "Editor de tema", sub: "Paquete autocontenido: contexto, mensajes clave, óptica y público. Sin tocar la rúbrica.",
        nameL: "Nombre del tema", nameV: "Retiro de producto", ctxL: "Contexto del escenario", ctxV: "Sector, tipo de crisis, situación de partida…",
        opticL: "Óptica institucional", optics: ["Empática", "Formal", "Técnica"], pubL: "Público interno", pubs: ["Dirección", "Planta", "Técnicos"],
        keyL: "Mensajes clave (sostener)", addMsg: "+ Añadir mensaje", redL: "Líneas rojas (nunca decir)", addRed: "+ Añadir línea roja",
        save: "Guardar tema", preview: "Vista previa de una sesión",
        note: "Mensajes clave y líneas rojas se editan como listas claras; alimentan la evaluación de “coherencia” aunque el admin no vea el scoring."
      },
      a3: {
        crumbs: "Admin del cliente › Configuración", title: "Política de retención", sub: "Decisión sensible de datos biométricos. La define el admin del cliente.",
        q1: "¿Qué se conserva tras cada sesión?", opt1: "Video + audio completos y métricas (permite autorrevisión y coaching)", opt2: "Solo métricas derivadas (no se guarda la grabación)",
        termL: "Plazo de conservación", terms: ["30 días", "90 días", "180 días", "Personalizado"], termLeg: "Al expirar, las grabaciones se borran/anonimizan automáticamente (job por cliente).",
        delL: "Solicitudes de borrado", th: ["Usuario", "Solicitado", ""], delRow: ["Vocero #14", "22 jun"], process: "Procesar",
        note: "El borrado por expiración y a solicitud son funciones de primera clase, no ajustes ocultos — exigido por el tratamiento de datos biométricos (UK GDPR)."
      },
      m1: {
        crumbs: "Configurador maestro", title: "Panel maestro", sub: "El equipo central: salud del estándar global, cola de revisión y métricas entre clientes.",
        st: ["Clientes activos", "Sesiones (semana)", "En cola de revisión", "Acuerdo IA-humano"],
        verL: "Versión del patrón maestro", verLeg: "v0.4 · vigente para todos los clientes", openRub: "Abrir editor de rúbrica →", distL: "Distribución de puntajes (global)", hist: "Histograma",
        note: "“Acuerdo IA-humano” es la métrica de calidad del producto: mide qué tanto coincide la IA con el etiquetado experto."
      },
      m2: {
        crumbs: "Configurador maestro › Estándar", title: "Editor de rúbrica / patrón maestro", sub: "Define qué es “buena vocería”. Transversal a todos los clientes; es el activo del producto.",
        areasL: "Áreas de evaluación y peso", th: ["Área", "Canal", "Criterios", "Peso"],
        rows: [["Expresión", "Imagen / no verbal", "Contacto visual, postura, gesto", "25%"], ["Tono de voz", "Voz / prosodia", "Ritmo, pausas, muletillas, firmeza", "25%"], ["Coherencia", "Contenido", "Mensajes puente, líneas clave", "30%"], ["Nivel de empatía", "Señal cruzada", "Congruencia, calidez, reconocimiento", "20%"]],
        descL: "Descriptores por nivel (área: empatia)", descV: "Nivel alto / medio / bajo: definiciones que guían al LLM-juez…",
        multiL: "Multiidioma", multiLeg: "La rúbrica de voz se ajusta por idioma (muletillas, ritmo).", publish: "Publicar versión", draft: "Guardar borrador",
        note: "Versionar el patrón permite re-evaluar grabaciones antiguas cuando cambie el estándar."
      },
      m3: {
        crumbs: "Configurador maestro › Calidad", title: "Cola de etiquetado y segunda opinión", sub: "El equipo central revisa casos de baja confianza; cada corrección calibra y entrena los modelos.",
        queueL: "Cola (23)", q1: "Confianza baja · empatía", q2: "Puntaje límite", q3: "Muestreo aleatorio",
        caseL: "Caso #8842 — revisión", rec: "Grabación", proposal: "Propuesta de la IA", areas: ["Expresión", "Tono", "Coherencia", "Empatía"],
        commentL: "Comentario del experto", confirm: "Confirmar / corregir", skip: "Saltar",
        note: "Esta pantalla es a la vez “segunda opinión” y generación de datos de entrenamiento. Un solo flujo, dos propósitos."
      },
      lesson: {
        crumbs: "Usuario final › Microlección", backTo: "Volver al inicio", mins: "4 min",
        objL: "Qué aprenderás", obj: "Cómo redirigir una pregunta difícil hacia tu mensaje clave sin evadir.",
        vidL: "Video / ejemplo", exL: "Ejemplo comentado", exV: "Antes / después de una respuesta real…", cta: "Practicar un escenario con esto →",
        note: "La microlección es teoría breve + ejemplo. No se evalúa: prepara al vocero. Al terminar, sugiere practicar un escenario relacionado."
      }
    }
  }
};

export default I;