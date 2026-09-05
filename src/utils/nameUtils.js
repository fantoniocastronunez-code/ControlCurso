export const formatStudentName = (student) => {
  if (!student) return 'Sin Nombre';
  
  if (student.lastNamePaternal || student.lastNameMaternal || student.firstName) {
    const pat = student.lastNamePaternal || '';
    const mat = student.lastNameMaternal || '';
    const first = student.firstName || '';
    const lastNames = [pat, mat].filter(Boolean).join(' ');
    return lastNames ? `${lastNames}, ${first}` : first;
  }
  
  // Retrocompatibilidad para alumnos que solo tienen el campo 'name'
  return student.name || 'Sin Nombre';
};
