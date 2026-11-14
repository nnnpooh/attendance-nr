/***
 * Swaps in the body of error pages returned from htmx requests
 */
document.addEventListener("htmx:beforeOnLoad", function (event) {
  const xhr = event.detail.xhr;
  if (
    xhr.status == 500 ||
    xhr.status == 403 ||
    xhr.status == 404 ||
    xhr.status == 401 ||
    xhr.status == 400
  ) {
    event.stopPropagation(); // Tell htmx not to process these requests
    // document.children[0].innerHTML = xhr.response; // Swap in body of response instead
    alert(xhr.response);
  }
});

//Set color scheme
function detectColorScheme() {
  document.documentElement.setAttribute("data-theme", "dark");
}
detectColorScheme();

// Close htmx-loaded dialogs (manual check-in etc.)
document.addEventListener("click", function (event) {
  const btn = event.target.closest("[data-close-dialog]");
  if (btn) {
    event.preventDefault();
    btn.closest("dialog")?.remove();
  }
});
document.addEventListener("keydown", function (event) {
  if (event.key === "Escape") document.querySelector("#modal dialog")?.remove();
});

// <select data-autosubmit> submits its form on change (e.g. Check-Ins course filter).
document.addEventListener("change", function (event) {
  if (event.target.matches("select[data-autosubmit]")) event.target.form?.submit();
});
