async function processMessage(db, message, guest){

  const texto = message.toLowerCase();

  // 🔥 FLOWS PRIMERO
  const flows = await db.query(
    "SELECT * FROM bot_flows WHERE company_id=$1",
    [guest.company_id]
  );

  for(const f of flows.rows){
    if(texto.includes(f.trigger.toLowerCase())){
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
      if(texto.includes(k.toLowerCase())){
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