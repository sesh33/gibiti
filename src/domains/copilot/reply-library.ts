export type TeamReply = {
  id: string;
  title: string;
  category: string;
  language: "EN" | "FR";
  body: string;
  note?: string;
};
export const teamReplies: TeamReply[] = [
  {
    id: "welcome-en",
    title: "Welcome & order details",
    category: "General",
    language: "EN",
    body: "Hi! Thanks for your order. I'll help you with the delivery. Could you confirm your in-game username and the product you purchased? Please keep all order communication here on Eldorado.",
  },
  {
    id: "coins-en",
    title: "Donut SMP · delivery details",
    category: "Donut SMP",
    language: "EN",
    body: "Hi! To arrange delivery of your [amount] Donut SMP coins, please confirm your exact Minecraft username and whether you are online on Donut SMP. We will confirm the delivery method with you here before proceeding.",
  },
  {
    id: "waiting-en",
    title: "Buyer offline",
    category: "Donut SMP",
    language: "EN",
    body: "We still need to confirm that [username] is online on Donut SMP before proceeding. Please reply when you are available so we can coordinate your delivery here.",
  },
  {
    id: "progress-en",
    title: "Checking delivery",
    category: "General",
    language: "EN",
    body: "Thanks for your patience. I'm checking the delivery details for your order. I'll update you here once I have confirmed information.",
  },
  {
    id: "delay-en",
    title: "Delay update",
    category: "General",
    language: "EN",
    body: "I'm sorry for the delay. We're checking [issue] and will update you here as soon as we have confirmed information. Thank you for your patience.",
    note: "Use a specific, verified explanation. Do not invent a delivery estimate.",
  },
  {
    id: "delivered-en",
    title: "Delivery confirmed",
    category: "Donut SMP",
    language: "EN",
    body: "We've confirmed the transfer of [amount] Donut SMP coins to [username]. Please check your balance and let us know here if anything looks wrong. Thank you!",
    note: "Use only after verifying the actual transfer and recording evidence in the order notes.",
  },
  {
    id: "robux-en",
    title: "Robux · request game pass link",
    category: "Roblox",
    language: "EN",
    body: "Hi! Please send your Roblox username and the direct link to the game pass for this order. The agreed pass price is [price] Robux. Please check that the pass is on sale at that price and that Regional Pricing is disabled. If you're stuck, send a screenshot of the page without passwords or account details.",
    note: "Confirm the required pass price from this order's terms, including applicable fees.",
  },
  {
    id: "refund-en",
    title: "Refund request",
    category: "Refunds",
    language: "EN",
    body: "I understand you would like a refund. I'll refer your request for review based on the order status and the marketplace rules. We will update you here once a decision is confirmed.",
    note: "This message does not approve a refund. Escalate the request to your supervisor.",
  },
  {
    id: "issue-en",
    title: "Delivery problem",
    category: "General",
    language: "EN",
    body: "Thanks for letting us know. Please describe what is missing or what happened, and share a screenshot if it helps. Do not include passwords, recovery codes or payment information. I'll review the order details with our team.",
  },
  {
    id: "coins-fr",
    title: "Donut SMP · informations",
    category: "Donut SMP",
    language: "FR",
    body: "Bonjour ! Pour organiser la livraison de vos [amount] de pièces Donut SMP, pouvez-vous confirmer votre pseudo Minecraft exact et nous dire si vous êtes connecté sur Donut SMP ? Nous confirmerons la méthode de livraison ici avant de procéder.",
  },
  {
    id: "robux-fr",
    title: "Robux · lien du pass",
    category: "Roblox",
    language: "FR",
    body: "Bonjour ! Envoyez-nous votre pseudo Roblox et le lien direct du pass de jeu créé pour cette commande. Le prix convenu est de [price] Robux. Vérifiez que le pass est en vente à ce prix et que la tarification régionale est désactivée. Si vous êtes bloqué, envoyez une capture de la page sans informations sensibles.",
    note: "Confirm the required price from the order. Never request the buyer's login.",
  },
  {
    id: "refund-fr",
    title: "Demande de remboursement",
    category: "Refunds",
    language: "FR",
    body: "Je comprends votre demande de remboursement. Je vais la transmettre pour examen selon l'état de la commande et les règles de la plateforme. Nous vous informerons ici dès qu'une décision sera confirmée.",
    note: "Refer to a supervisor. Do not pressure the buyer to close a dispute.",
  },
];
