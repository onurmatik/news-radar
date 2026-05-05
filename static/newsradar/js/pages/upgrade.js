export function initUpgrade(context) {
  const messageRoot = document.getElementById("checkout-message");
  const errorRoot = document.getElementById("upgrade-error");
  const alreadyProCard = document.getElementById("already-pro-card");
  const plansGrid = document.getElementById("plans-grid");
  const params = new URLSearchParams(window.location.search);
  let submittingPlan = null;

  function renderCheckoutMessage() {
    if (!messageRoot) return;
    const state = params.get("checkout");
    if (state === "success") {
      messageRoot.innerHTML = '<div class="card border-emerald-200 bg-emerald-50 p-4 text-sm text-slate-800">Payment received. Your Pro membership is being activated.</div>';
    } else if (state === "cancelled") {
      messageRoot.innerHTML = '<div class="card bg-slate-50 p-4 text-sm text-slate-500">Checkout was cancelled. You can restart anytime.</div>';
    } else {
      messageRoot.innerHTML = "";
    }
  }

  function setError(message) {
    if (!errorRoot) return;
    if (message) {
      errorRoot.textContent = message;
      errorRoot.classList.remove("hidden");
    } else {
      errorRoot.classList.add("hidden");
    }
  }

  function renderAuthState() {
    const alreadyPro = context.state.currentUser && context.state.currentUser.is_pro === true;
    if (alreadyProCard) {
      if (alreadyPro) {
        const plan = context.state.currentUser.pro_plan === "yearly" ? "Yearly" : "Monthly";
        alreadyProCard.innerHTML = `<h2 class="text-xl font-semibold text-slate-900">You are already Pro</h2><p class="mt-1 text-sm text-slate-600">Active plan: ${plan}</p>`;
      }
      alreadyProCard.classList.toggle("hidden", !alreadyPro);
    }
    plansGrid?.classList.toggle("hidden", Boolean(alreadyPro));
  }

  async function startCheckout(plan, button) {
    if (!context.ensureAuth()) return;
    submittingPlan = plan;
    setError(null);
    button.disabled = true;
    button.textContent = "Redirecting...";
    try {
      const baseUrl = window.location.origin;
      const result = await context.api.createProCheckoutSession({
        plan,
        successUrl: `${baseUrl}/upgrade?checkout=success`,
        cancelUrl: `${baseUrl}/upgrade?checkout=cancelled`,
      });
      window.location.assign(result.checkout_url);
    } catch (error) {
      submittingPlan = null;
      setError(error instanceof Error ? error.message : "Unable to start checkout right now.");
      button.disabled = false;
      button.textContent = plan === "monthly" ? "Choose monthly" : "Choose yearly";
    }
  }

  plansGrid?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-plan]");
    if (!button || submittingPlan) return;
    startCheckout(button.dataset.plan, button);
  });

  context.subscribe(renderAuthState);
  renderCheckoutMessage();
  renderAuthState();
}
