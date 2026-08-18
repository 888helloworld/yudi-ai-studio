const express = require('express');
const { POINT_PACKAGES } = require('../config/points');
const { getPublicStats } = require('../repositories/stats-repository');

function createPublicInfoRouter({ optionalAuth }) {
  const router = express.Router();

  router.get('/api/user/info', optionalAuth, (req, res) => {
    if (req.user) res.json({ loggedIn: true, user: req.user });
    else res.json({ loggedIn: false });
  });

  router.get('/api/packages', (req, res) => {
    res.json({ packages: POINT_PACKAGES, paymentAvailable: false });
  });

  router.get('/api/public/stats', (req, res) => {
    res.json(getPublicStats());
  });

  return router;
}

module.exports = {
  createPublicInfoRouter
};
