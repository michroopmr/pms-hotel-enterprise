function normalize(text){
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

async function processMessage(db, message, guest){

  const texto = message.toLowerCase();

  // 👉 SALUDO
  if(texto.includes("hola") || texto.includes("buenas")){
    return {
      reply: "Hola 👋 ¿En qué puedo ayudarte?",
      type: "saludo"
    };
  }

  // 👉 FALLAS (CREA TAREA)
  if(
    texto.includes("no funciona") ||
    texto.includes("falla") ||
    texto.includes("no sirve") ||
    texto.includes("problema")
  ){
    return {
      reply: "Gracias, lo reporto de inmediato 🔧",
      type: "falla",
      department: "Mantenimiento"
    };
  }

  // 👉 SERVICIOS (CREA TAREA)
  if(
    texto.includes("toalla") ||
    texto.includes("limpieza") ||
    texto.includes("room service") ||
    texto.includes("comida")
  ){
    return {
      reply: "Claro, lo solicito enseguida 🛎️",
      type: "servicio",
      department: "Housekeeping"
    };
  }

  // 👉 CONSULTA
  if(texto.includes("gracias")){
    return {
      reply: "Con gusto 😊",
      type: "otro"
    };
  }

  // 👉 DEFAULT
  return {
    reply: "¿Puedes darme más detalles? 🤔",
    type: "otro"
  };
}

module.exports = { processMessage };