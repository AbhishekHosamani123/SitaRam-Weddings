function renderPreviewShell({ token, expiresAt, paid = false, publishedUrl = "" }) {
  const safeToken = String(token || "").replace(/[^a-f0-9]/gi, "");
  const safeExpiresAt = new Date(expiresAt).toISOString();
  const safePublishedUrl = JSON.stringify(publishedUrl);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="referrer" content="no-referrer">
<title>Wedding preview — SitaRam Weddings</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{color-scheme:light;--ink:#3d222a;--muted:#735660;--brand:#c2535f;--gold:#e8b04b;--line:#f0ddd3;--paper:#fffdf9}
*{box-sizing:border-box}html,body{height:100%;margin:0}body{font-family:Inter,Arial,sans-serif;color:var(--ink);background:#fff9f3}
.bar{position:relative;z-index:3;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px clamp(14px,3vw,32px);background:#fffdf9;border-bottom:1px solid var(--line);box-shadow:0 4px 20px #3d222a12}
.brand{font-family:"Bricolage Grotesque",sans-serif;font-weight:700;font-size:17px}.meta{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.badge{font-size:13px;font-weight:700;color:#7a3a12;background:#fff0d6;border:1px solid #efd29f;border-radius:999px;padding:8px 12px}
.expires{font-size:12px;color:var(--muted)}
.unlock{border:0;border-radius:999px;background:linear-gradient(120deg,#d96c7a,#e8b04b);color:white;font-weight:700;font-size:14px;padding:12px 20px;min-height:44px;cursor:pointer;box-shadow:0 8px 18px #c2535f35}
.unlock:disabled{opacity:.6;cursor:wait}.layout{height:calc(100% - 70px);min-height:0;position:relative}.site{display:block;width:100%;height:100%;border:0;background:#fff}
.lock{position:absolute;inset:0;z-index:4;display:none;place-items:center;padding:20px;background:#fff9f3eF;text-align:center}.lock.show{display:grid}.lock-card{max-width:480px;padding:28px;background:#fff;border:1px solid var(--line);border-radius:22px;box-shadow:0 18px 50px #3d222a20}.lock h1{font-family:"Bricolage Grotesque",sans-serif;margin:0 0 8px;font-size:clamp(24px,4vw,36px)}.lock p{line-height:1.55;color:var(--muted);margin:0 0 18px}
.status{position:fixed;z-index:5;left:50%;bottom:16px;transform:translateX(-50%);padding:10px 16px;border-radius:999px;background:#3d222a;color:#fff;box-shadow:0 8px 24px #3d222a33;font-size:13px;display:none;max-width:calc(100% - 24px);text-align:center}
.status.show{display:block}.status.error{background:#9e2620}
@media(max-width:640px){.bar{align-items:flex-start}.meta{justify-content:flex-end;gap:8px}.expires{width:100%;text-align:right}.unlock{padding:10px 14px}.layout{height:calc(100% - 104px)}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
</style>
</head>
<body>
<header class="bar">
  <div class="brand">SitaRam Weddings</div>
  <div class="meta">
    <span class="badge" id="attemptBadge">${paid ? "Payment verified" : "Checking preview attempts…"}</span>
    <span class="expires" id="expiry"></span>
    <button class="unlock" id="unlock" type="button" ${paid ? "hidden" : ""}>${paid ? "Unlocked" : "Unlock for ₹999"}</button>
  </div>
</header>
<main class="layout">
  <iframe class="site" id="site" title="Watermarked wedding website preview" referrerpolicy="no-referrer"></iframe>
  <section class="lock" id="lock" role="dialog" aria-modal="true" aria-labelledby="lockTitle">
    <div class="lock-card">
      <h1 id="lockTitle">Your free previews are used</h1>
      <p>Unlock the full wedding website for ₹999. Your preview link is valid for 24 hours.</p>
      <button class="unlock" id="unlockLocked" type="button">Pay ₹999 to unlock</button>
    </div>
  </section>
</main>
<div class="status" id="status" role="status" aria-live="polite"></div>
<script>
(function(){
  "use strict";
  var token=${JSON.stringify(safeToken)};
  var expiry=new Date(${JSON.stringify(safeExpiresAt)});
  var paid=${paid ? "true" : "false"};
  var publishedUrl=${safePublishedUrl};
  var maxAttempts=3;
  var key="srw_preview_attempts_v1";
  var attempts=0;
  var storageAvailable=true;
  try{attempts=Math.max(0,Number(localStorage.getItem(key))||0)}catch(e){storageAvailable=false}
  var site=document.getElementById("site");
  var badge=document.getElementById("attemptBadge");
  var lock=document.getElementById("lock");
  var status=document.getElementById("status");
  var unlockButtons=[document.getElementById("unlock"),document.getElementById("unlockLocked")];
  function showStatus(message,error){status.textContent=message;status.className="status show"+(error?" error":"")}
  function hideStatus(){status.className="status"}
  function removeWatermark(){
    var doc=site.contentDocument;
    if(!doc)return;
    var mark=doc.getElementById("srw-preview-watermark");
    var style=doc.getElementById("srw-preview-watermark-style");
    if(mark)mark.remove();
    if(style)style.remove();
  }
  function countAttempt(){
    if(paid)return true;
    if(!storageAvailable){
      badge.textContent="Enable browser storage to view preview";
      lock.classList.add("show");
      site.hidden=true;
      return false;
    }
    if(attempts<maxAttempts){
      attempts++;
      try{localStorage.setItem(key,String(attempts))}catch(e){
        storageAvailable=false;
        badge.textContent="Enable browser storage to view preview";
        lock.classList.add("show");
        site.hidden=true;
        return false;
      }
    }else{
      lock.classList.add("show");
      site.hidden=true;
      return false;
    }
    badge.textContent=attempts>=maxAttempts?"Last free preview · "+attempts+" of "+maxAttempts: "Free preview · "+attempts+" of "+maxAttempts;
    return true;
  }
  document.getElementById("expiry").textContent=paid?"":"Preview expires "+expiry.toLocaleString();
  if(paid){
    badge.textContent="Payment verified";
    if(publishedUrl){location.replace(publishedUrl);return}
  }
  if(paid||countAttempt()){
    site.src="/api/draft-site?token="+encodeURIComponent(token);
  }
  async function publishAfterPayment(payment){
    showStatus("Payment received — publishing your website…",false);
    try{
      var r=await fetch("/api/publish-preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({draft_token:token})});
      var data=await r.json().catch(function(){return {}});
      if(!r.ok)throw new Error(data.error||"Payment was received, but publishing failed.");
      showStatus("Your website is live. Opening it…",false);
      location.assign(data.url);
    }catch(error){showStatus(error.message+" You can retry publishing from this preview.",true)}
  }
  async function startCheckout(){
    if(paid){showStatus("Payment verified — finishing your website…",false);return publishAfterPayment(null)}
    unlockButtons.forEach(function(button){button.disabled=true});
    showStatus("Opening secure Razorpay checkout…",false);
    try{
      var orderResponse=await fetch("/api/razorpay/order",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({amount:99900,draft_token:token})});
      var order=await orderResponse.json().catch(function(){return {}});
      if(!orderResponse.ok||!order.order_id)throw new Error(order.error||"Could not start payment.");
      if(!window.Razorpay){
        await new Promise(function(resolve,reject){
          var script=document.createElement("script");script.src="https://checkout.razorpay.com/v1/checkout.js";
          script.onload=resolve;script.onerror=function(){reject(new Error("Could not load Razorpay checkout."))};document.head.appendChild(script);
        });
      }
      var checkout=new Razorpay({key:order.key_id,amount:order.amount,currency:order.currency||"INR",name:"SitaRam Weddings",description:"Wedding website unlock · ₹999",order_id:order.order_id,theme:{color:"#c2535f"},handler:async function(result){
        try{
          var verifiedResponse=await fetch("/api/razorpay/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({order_id:result.razorpay_order_id,payment_id:result.razorpay_payment_id,signature:result.razorpay_signature,draft_token:token})});
          var verified=await verifiedResponse.json().catch(function(){return {}});
          if(!verifiedResponse.ok||!verified.ok)throw new Error(verified.error||"Payment verification failed.");
          paid=true;removeWatermark();badge.textContent="Payment verified";document.getElementById("unlock").hidden=true;lock.classList.remove("show");
          await publishAfterPayment({order_id:result.razorpay_order_id,payment_id:result.razorpay_payment_id,signature:result.razorpay_signature});
        }catch(error){showStatus(error.message+" Contact us if your payment was charged.",true)}
      },modal:{ondismiss:function(){hideStatus();unlockButtons.forEach(function(button){button.disabled=false})}});
      checkout.open();
      hideStatus();
    }catch(error){showStatus(error.message,true);unlockButtons.forEach(function(button){button.disabled=false})}
  }
  unlockButtons.forEach(function(button){button.addEventListener("click",startCheckout)});
  if(paid&&!publishedUrl){
    document.getElementById("unlock").hidden=false;
    document.getElementById("unlock").textContent="Finish publishing";
  }
})();
</script>
</body>
</html>`;
}

module.exports = { renderPreviewShell };
