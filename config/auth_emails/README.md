# PowerKlock account e-mails (Supabase Auth)

The two e-mails a visitor receives, in PowerKlock's look, to paste once into Supabase:
Dashboard › Authentication › Emails › Templates.

| Supabase template | Subject | Body (Source) |
|---|---|---|
| Confirm signup | `Confirmez votre adresse PowerKlock` | `confirm_signup.html` |
| Reset password | `Votre nouveau mot de passe PowerKlock` | `reset_password.html` |

`{{ .ConfirmationURL }}` is filled by Supabase. The site sends people back to `https://powerklock.com/?pk=confirmed`
(confirmation) or `?pk=reset` (new password, js/dashboard.js › authModal): Authentication › URL Configuration must have
Site URL `https://powerklock.com` and the redirect URLs `https://powerklock.com/**` and `https://www.powerklock.com/**`.

Supabase's built-in mail server only writes to the project's team and to a few addresses an hour: set your own SMTP in
Authentication › Emails › SMTP Settings (the same server as the morning e-mail, whose settings are the GitHub secrets
SMTP_HOST, SMTP_USER, SMTP_PASS), sender `PowerKlock`.
