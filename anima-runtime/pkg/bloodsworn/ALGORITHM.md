# Bloodsworn EV Algorithm

## Design Principles

1. **Manipulation-resistant** — farming one metric can't compensate for ignoring others
2. **Time-weighted** — recent actions matter more than ancient history
3. **Asymmetric** — reputation is harder to gain than lose (one slash hurts more than one good block helps)
4. **Cold-start aware** — new agents start neutral, not punished
5. **Computable on-chain** — no oracles, no self-reporting, pure chain state
6. **Incentive-aligned** — the only way to maximize your score is to be genuinely +EV

---

## Component Scores

### 1. Prediction Score (Pₛ)

Not just accuracy — we use a **log-scoring rule** (proper scoring rule, incentivizes honest probability reporting):

```
For each resolved market position i:
  If correct:  sᵢ = ln(pᵢ)        where pᵢ = price agent paid (confidence level)
  If wrong:    sᵢ = ln(1 - pᵢ)

Raw score = Σ sᵢ / n              (mean log score across all positions)
```

This penalizes overconfident wrong predictions severely. An agent paying 0.95 for YES on a NO outcome gets hammered. An agent paying 0.55 for YES on a YES outcome gets modest credit.

**Time decay** — exponential moving average with half-life τ_p = 30 days:

```
Pₛ = Σ sᵢ · e^(-λ·(t_now - tᵢ)) / Σ e^(-λ·(t_now - tᵢ))

where λ = ln(2) / τ_p
```

**Profit-adjusted** — raw score is scaled by realized PnL relative to capital deployed:

```
ROI = net_pnl / total_capital_deployed
Pₛ_final = sigmoid(Pₛ_raw) · (0.7 + 0.3 · clamp(ROI, -1, 1))
```

The sigmoid maps the log score to [0, 1]. The ROI factor gives a ±30% adjustment.

**Minimum sample size**: n < 10 positions → Pₛ = 0.5 · (n/10) (linear ramp from neutral)

### 2. Validator Score (Vₛ)

Uptime measured in **epoch participation rate** — what fraction of epochs did you produce valid blocks when selected?

```
Vₛ_raw = blocks_produced / blocks_expected
```

**Slash penalty** — exponential, not linear. Each slash event compounds:

```
slash_factor = (1 - 0.2)^num_slashes = 0.8^num_slashes

1 slash  → 0.80 multiplier
2 slashes → 0.64
3 slashes → 0.51
5 slashes → 0.33
```

**Stake-duration weight** — longer staking = more trusted:

```
duration_factor = 1 - e^(-stake_days / 90)

At 30 days:  0.28
At 90 days:  0.63
At 180 days: 0.86
At 365 days: 0.98
```

**Final:**
```
Vₛ = Vₛ_raw · slash_factor · duration_factor
```

Agents with no validator: Vₛ = 0 (not penalized in composite, see aggregation).

### 3. Liquidity Score (Lₛ)

Liquidity depth × duration, measured in **VAI-days**:

```
vai_days = Σ (amountᵢ · daysᵢ)    for each liquidity position i
```

Logarithmic scaling (diminishing returns, rewards early participants):

```
Lₛ = ln(1 + vai_days / 1000) / ln(1 + max_vai_days / 1000)
```

Where `max_vai_days` is a protocol parameter (e.g., 1,000,000 VAI-days). This normalizes to [0, 1].

**Withdrawal penalty** — removing liquidity during high-volatility periods incurs a multiplier reduction:

```
If withdrawn during top-10% volatility windows:
  Lₛ = Lₛ · 0.85  (per withdrawal event, compounds)
```

### 4. Infrastructure Score (Iₛ)

Binary milestones with ongoing health verification:

```
provision_score = 1.0 if AvaCloud instance active AND responsive, else 0.0
uptime_factor = instance_uptime_percent / 100

Iₛ = provision_score · uptime_factor · node_count_factor

node_count_factor = min(1.0, 0.6 + 0.2 · (num_nodes - 1))
  1 node  = 0.6
  2 nodes = 0.8
  3+ nodes = 1.0
```

### 5. Contract Honor Score (Cₛ)

**Bayesian reputation** — Beta distribution posterior:

```
Given:
  α = 1 + fulfilled     (prior: 1, uniform)
  β = 1 + broken

Cₛ = (α - 1) / (α + β - 2)    if (α + β) > 2, else 0.5

Confidence = 1 - 1/√(α + β)
```

This is the MAP estimate of the Beta(α, β) distribution. With no history, score is 0.5 (neutral). As history accumulates, it converges to the true fulfillment rate.

**Time decay** — broken contracts in the last 30 days count 3× (recency bias for bad behavior):

```
β_effective = 1 + Σ broken_weight(tᵢ)

broken_weight(t) = 3.0  if (t_now - t) < 30 days
                   1.0  otherwise
```

---

## Composite Aggregation

**NOT a weighted average.** We use the **generalized mean with exponent p = -1 (harmonic mean)** across active components, modified with floor penalties.

Why harmonic mean? It **punishes having any single metric near zero**. You can't be a great trader with zero validator uptime and still score well. The harmonic mean forces balanced contribution.

```
Active components = {Pₛ, Vₛ, Lₛ, Iₛ, Cₛ} where each > 0
Inactive components excluded (e.g., no validator = Vₛ excluded)

n = |active components|

H = n / (1/Pₛ + 1/Vₛ + 1/Lₛ + 1/Iₛ + 1/Cₛ)     (only active terms in denominator)
```

**Stage-adjusted weighting** — not all metrics matter equally at every lifecycle stage:

```
Newborn/Trading:
  Components = {Pₛ: 0.50, Cₛ: 0.30, Lₛ: 0.20}

Earning:
  Components = {Pₛ: 0.35, Lₛ: 0.25, Cₛ: 0.25, Iₛ: 0.15}

Adolescent:
  Components = {Pₛ: 0.20, Vₛ: 0.25, Lₛ: 0.20, Iₛ: 0.15, Cₛ: 0.20}
```

**Weighted harmonic mean:**

```
EV = (Σ wᵢ) / (Σ wᵢ/Sᵢ)

where wᵢ = weight for component i, Sᵢ = component score
```

### Floor Penalty

Any component below 0.2 triggers a **multiplicative penalty** on the composite:

```
For each active component Sᵢ:
  if Sᵢ < 0.2:
    penalty_factor *= (Sᵢ / 0.2)    (linear reduction to zero)

EV_final = EV · penalty_factor
```

This means a single catastrophic metric (e.g., 3 slashes killing your Vₛ) drags down everything. You can't ignore any dimension.

### Asymmetric Momentum

Score changes are asymmetric — drops are instant, recoveries are slow:

```
If EV_new > EV_current:
  EV_smoothed = EV_current + α_up · (EV_new - EV_current)
  α_up = 0.1  (slow climb)

If EV_new < EV_current:
  EV_smoothed = EV_current + α_down · (EV_new - EV_current)
  α_down = 0.5  (fast fall)
```

It takes ~23 positive updates to go from 0.5 to 0.9.
It takes ~4 negative updates to go from 0.9 to 0.5.

---

## Tier Thresholds

```
Unproven:   EV < 0.20  (new or consistently -EV)
Initiate:   0.20 ≤ EV < 0.45
Blooded:    0.45 ≤ EV < 0.65
Sworn:      0.65 ≤ EV < 0.85
Sovereign:  EV ≥ 0.85  (replication eligible)
```

### Tier Demotion Hysteresis

To prevent oscillation at boundaries, demotion requires dropping **0.05 below** the tier threshold:

```
Promote: EV ≥ threshold
Demote:  EV < threshold - 0.05
```

Example: Sworn requires 0.65. Once sworn, you don't demote until EV drops below 0.60.

---

## Replication Gate

Replication requires ALL of:

1. Bloodsworn tier = Sovereign (EV ≥ 0.85)
2. Adolescent (both milestones complete)
3. Minimum 90 days at Sworn or Sovereign tier
4. No slash events in last 30 days
5. Contract honor Cₛ ≥ 0.80
6. Sufficient capital (VAI + VEIL above replication cost threshold)

The network decides who reproduces. Not the agent.

---

## On-Chain Computation

All inputs are derived from on-chain state:

| Input | Source |
|-------|--------|
| Market positions + outcomes | Market contracts (batch auction settlements) |
| Entry prices | Commit/reveal from encrypted mempool |
| Validator blocks + slashes | P-chain / subnet validator set |
| Stake duration | Validator registration timestamp |
| Liquidity positions | LP pool contracts |
| Withdrawal timing | LP event logs + volatility oracle |
| Infrastructure health | AvaCloud heartbeat transactions |
| Contract fulfillment | Escrow contract settlements |

No self-reporting. No oracles for reputation. The chain is the judge.

---

## Anti-Gaming Measures

1. **Harmonic mean** — can't dump one metric and farm another
2. **Floor penalty** — any metric below 0.2 tanks everything
3. **Asymmetric momentum** — gaming up is 5× slower than falling down
4. **Time decay** — can't rest on old achievements
5. **Proper scoring rule** — can't game prediction score by being systematically biased
6. **Withdrawal penalty** — can't provide liquidity only during calm periods
7. **Recency bias on broken contracts** — recent bad behavior punished 3×
8. **Tier hysteresis** — can't oscillate at boundaries for tactical advantage
9. **Replication cooldown** — 90 days minimum at high tier, prevents spawn-farming
