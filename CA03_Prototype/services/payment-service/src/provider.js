/**
 * Simulated external payment provider (stands in for a real gateway such as
 * Stripe/PayHere in test mode - no money moves). Test cards:
 *   4242 4242 4242 4242 / 5555 5555 5555 4444  -> approved
 *   4000 0000 0000 0002                        -> card_declined
 *   4000 0000 0000 9995                        -> insufficient_funds
 */
const crypto = require('crypto');

const DECLINES = { '4000000000000002': 'card_declined', '4000000000009995': 'insufficient_funds' };

function luhnValid(number) {
  let sum = 0;
  for (let i = 0; i < number.length; i++) {
    let d = Number(number[number.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function brandOf(number) {
  if (number.startsWith('4')) return 'Visa';
  if (/^5[1-5]/.test(number)) return 'Mastercard';
  if (/^3[47]/.test(number)) return 'Amex';
  return 'Card';
}

function validateCard({ cardNumber, expMonth, expYear, cvc }) {
  const number = String(cardNumber || '').replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(number) || !luhnValid(number)) return { error: 'card number is invalid' };
  const month = Number(expMonth);
  let year = Number(expYear);
  if (year < 100) year += 2000;
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) return { error: 'expiry date is invalid' };
  const now = new Date();
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) return { error: 'card has expired' };
  if (!/^\d{3,4}$/.test(String(cvc || ''))) return { error: 'CVC is invalid' };
  return { number, brand: brandOf(number), last4: number.slice(-4) };
}

async function charge(card, amount) {
  await new Promise((r) => setTimeout(r, 400));
  const providerRef = `sim_${crypto.randomBytes(8).toString('hex')}`;
  const decline = DECLINES[card.number];
  if (decline) return { approved: false, reason: decline, providerRef };
  if (!(amount > 0)) return { approved: false, reason: 'invalid_amount', providerRef };
  return { approved: true, providerRef };
}

module.exports = { validateCard, charge };
