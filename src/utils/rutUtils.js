export const formatRut = (rut) => {
  if (!rut) return '';
  
  // Remove everything except numbers and K
  let cleanRut = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  
  if (cleanRut.length === 0) return '';
  if (cleanRut.length <= 1) return cleanRut;
  
  // Extract digit verifier (DV) and body
  let dv = cleanRut.slice(-1);
  let body = cleanRut.slice(0, -1);
  
  // Add dots to body
  let formattedBody = '';
  while (body.length > 3) {
    formattedBody = '.' + body.slice(-3) + formattedBody;
    body = body.slice(0, -3);
  }
  formattedBody = body + formattedBody;
  
  return formattedBody + '-' + dv;
};
