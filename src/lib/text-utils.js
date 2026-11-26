export function decodeHtmlEntities(value = "") {
  if (!/[&][#a-z0-9]+;/i.test(value)) return value;
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${value}`, "text/html");
  return parsed.body.textContent || value;
}
