const POINTS = Object.freeze({
  image: 10,
  copy: 5,
  rewrite: 3,
  both: 15
});

const POINT_PACKAGES = Object.freeze([
  Object.freeze({ points: 100, price: 9.9, label: '100积分' }),
  Object.freeze({ points: 300, price: 24.9, label: '300积分' }),
  Object.freeze({ points: 500, price: 39.9, label: '500积分' }),
  Object.freeze({ points: 1000, price: 69.9, label: '1000积分' }),
  Object.freeze({ points: 3000, price: 179.9, label: '3000积分' }),
  Object.freeze({ points: 5000, price: 269.9, label: '5000积分' })
]);

module.exports = {
  POINTS,
  POINT_PACKAGES
};
