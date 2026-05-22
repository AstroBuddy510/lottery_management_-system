const appPromise = import("../artifacts/api-server/dist/app.mjs").then(m => m.default);

module.exports = async (req, res) => {
  const app = await appPromise;
  return app(req, res);
};
