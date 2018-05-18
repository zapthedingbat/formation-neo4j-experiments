// Crappy little utility function to create a delayed resolving promise
exports = module.exports = (ms) => new Promise((resolve) => setTimeout(resolve, ms));