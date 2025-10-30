**Linux Deployment**

Use this guide when you roll the SIMPEG journal bot onto a Linux server.

- **Packages**  
  - `sudo apt update && sudo apt install -y git docker.io docker-compose-plugin`  
  - `sudo systemctl enable --now docker`

- **Clone**  
  - `git clone https://github.com/guspra/smpgbt-lnx.git /opt/smpgbt`  
  - `cd /opt/smpgbt`

- **Environment**  
  - `cp .env.example .env` (if present) and fill `NIP`, `PASSWORD`, schedule values, etc.  
  - Keep `.env` owned by the user that will run the job.

- **Smoke Test**  
  - `chmod +x run.sh`  
  - `./run.sh`  
  - Confirm the script finishes and leaves `proof.png` in the repo root.

- **Cron (optional)**  
  - `crontab -e`  
  - `5 7 * * 1-5 /opt/smpgbt/run.sh >> /var/log/smpgbt.log 2>&1`

- **Logs**  
  - `tail -f /var/log/smpgbt.log`  
  - `docker logs smpgbt-run` if you keep the container around for debugging.

- **Secrets**  
  - Never check `.env` into git. Ensure file permissions restrict access: `chmod 600 .env`.

