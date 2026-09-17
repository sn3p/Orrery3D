const assert = require("node:assert/strict");

exports.dismissMoveNotice = async page => {
  const dialog = page.getByRole("dialog", { name: "Orrery3D has moved" });
  await dialog.getByRole("button", { name: "Close move notice" }).click();
  assert(await dialog.isHidden(), "Production-entry checks dismiss the move notice before using the historical UI");
};
