# Photon

Solana tip oracle built on Solami. The task spec lives in the session; the
code style rules are: TypeScript strict ESM, functions and plain objects, almost
no comments, constants in `src/config.ts`, no em dashes anywhere.

## Git rules

1. Use exactly one branch: `claude/wonderful-gates-h1nwcp`. If you are on any
   other branch, `git checkout claude/wonderful-gates-h1nwcp` first.
2. Commit after every phase and push to this same branch immediately
   (`git push -u origin claude/wonderful-gates-h1nwcp`), without asking.
3. Never create or switch branches, never force-push, never rewrite history
   (no rebase, amend or reset of pushed commits), never push to `main`, and
   never delete a branch.
4. Commits are authored as `Abubakar-Sadiq Saidu <assaidu2002@gmail.com>`
   with no co-author trailers.
5. `.env` is gitignored; never commit or print API keys or wallet secrets.
