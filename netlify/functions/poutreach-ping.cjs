exports.handler = async () => ({
  statusCode: 200,
  headers: {'Content-Type':'application/json','Cache-Control':'no-store'},
  body: JSON.stringify({ok:true, version:'2026-09-20-master-inbox-preview'})
});
