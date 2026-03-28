function normalize(text){
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

async function processMessage(db, message, guest){

  const texto = normalize(message || "");

  // 🔥 FLOWS
  const flows = await db.query(
    "SELECT * FROM bot_flows WHERE company_id=$1",
    [guest.company_id]
  );

  for(const f of flows.rows){

    const triggerNorm = normalize(f.trigger);

    if(texto.includes(triggerNorm)){
      return {
        type: "flow",
        reply: f.response
      };
    }
  }

  // 🔥 SERVICIOS
  const services = await db.query(
    "SELECT * FROM service_catalog WHERE company_id=$1",
    [guest.company_id]
  );

  for(const s of services.rows){
    for(const k of s.keywords){

      const keywordNorm = normalize(k);

      if(texto.includes(keywordNorm)){
        return {
          type: s.type,
          department: s.department,
          reply: s.auto_response || "En breve atendemos tu solicitud"
        };
      }

    }
  }

  return {
    type: "none",
    reply: "¿En qué puedo ayudarte?"
  };
}

module.exports = { processMessage };