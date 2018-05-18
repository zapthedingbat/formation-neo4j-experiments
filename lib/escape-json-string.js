// Crappy little utility function to escape strings that might contain quotes
exports = module.exports = (value) => value.replace(/[\\"]/g, a=>'\\'+a);