// Turn a title into a URL-friendly slug.
function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-");
}

module.exports = { slugify };
