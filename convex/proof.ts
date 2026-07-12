import { query } from './_generated/server'

function median(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

export const getProofSummary = query({
  args: {},
  handler: async (ctx) => {
    const [users, analyses, payments, agentRuns] = await Promise.all([
      ctx.db.query('users').collect(),
      ctx.db.query('analyses').collect(),
      ctx.db.query('payments').collect(),
      ctx.db.query('agentRuns').collect(),
    ])

    const completed = analyses.filter((analysis) => analysis.status === 'completed')
    const paid = payments.filter((payment) => payment.status === 'paid')
    const completionTimes = completed
      .filter((analysis) => analysis.completedAt !== undefined)
      .map((analysis) => analysis.completedAt! - analysis.startedAt)

    return {
      users: users.length,
      completedAnalyses: completed.length,
      activationRate: users.length === 0 ? 0 : completed.length / users.length,
      medianCompletionMs: median(completionTimes),
      paidBuyers: new Set(paid.map((payment) => payment.userId)).size,
      settledRevenueUsdCents: paid.reduce(
        (total, payment) => total + payment.amountUsdCents,
        0,
      ),
      failures:
        analyses.filter((analysis) => analysis.status === 'failed').length +
        agentRuns.filter((run) => run.status === 'failed').length,
    }
  },
})
