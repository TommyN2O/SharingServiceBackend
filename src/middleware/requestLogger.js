const requestLogger = (req, res, next) => {
  // Get the URL path without the base URL
  const url = req.originalUrl;

  // Log the request
  console.log(`:: [${req.method}] [${url}]`);

  next();
};

module.exports = requestLogger;
