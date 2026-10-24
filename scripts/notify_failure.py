"""A short e-mail when a data job fails (or SUBJECT / BODY for another alert, e.g. storage) (last step of the workflows, `if: failure()`), sent through the Gmail
account already used for the GO prices (GO_GMAIL_USER / GO_GMAIL_APP_PASSWORD) to itself. Free, no new service.
Does nothing without those secrets."""
import os, smtplib, sys
from email.message import EmailMessage

user, pwd = os.environ.get('GO_GMAIL_USER'), os.environ.get('GO_GMAIL_APP_PASSWORD')
if not user or not pwd:
    sys.exit(0)
wf, url = os.environ.get('WORKFLOW', 'a workflow'), os.environ.get('RUN_URL', '')
m = EmailMessage()
m['Subject'] = os.environ.get('SUBJECT') or f'PowerKlock · échec : {wf}'
m['From'] = m['To'] = user
m.set_content(os.environ.get('BODY') or (f"Le job « {wf} » a échoué.\n\nDétail du passage : {url}\n\nLes données concernées restent celles du passage précédent ; "
              "la page Data status du site montre leur fraîcheur et les trous éventuels.\n\n— PowerKlock"))
with smtplib.SMTP_SSL('smtp.gmail.com', 465, timeout=30) as s:
    s.login(user, pwd)
    s.send_message(m)
print('failure e-mail sent')
