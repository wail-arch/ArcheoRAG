# ArcheoQA tester setup

This guide is for archaeology testers who want to run ArcheoQA locally without installing Python, Node, PaperQA, or developer dependencies.

The recommended setup is Docker Desktop.

## 1. Install Docker Desktop

Download Docker Desktop for Windows:

https://www.docker.com/products/docker-desktop/

After installation:

1. Open Docker Desktop.
2. Wait until Docker says it is running.
3. Keep Docker Desktop open while using ArcheoQA.

You do not need to click anything in Docker Desktop for the first launch. The first launch is done with one PowerShell command below. After that, the app appears in Docker Desktop under **Containers** as `archeorag`.

## 2. Start ArcheoQA

### Option A: NVIDIA RTX / CUDA mode

Use this if your computer has an NVIDIA RTX GPU, for example RTX 3060 or better.

If you have an RTX GPU, run this command first and skip the CPU command.

```powershell
cd C:\Users\Wail\Desktop\archeorag
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
```

GPU mode is faster for local embeddings and indexing, but the first build is much larger because Docker installs CUDA-enabled PyTorch dependencies inside the container.

Your Windows CUDA or Python install is not reused by Docker. Docker only reuses the NVIDIA driver and GPU access from your machine.

### Option B: normal CPU mode

Use this if you do not have an NVIDIA RTX GPU, or if GPU startup fails.

```powershell
cd C:\Users\Wail\Desktop\archeorag
docker compose up --build
```

CPU mode is slower for indexing, but it is the safest fallback because it avoids CUDA and NVIDIA setup problems.

## 3. Open the app

When the containers are running, open:

```text
http://localhost:5173
```

In Docker Desktop, go to **Containers**. You should see a group called `archeorag` with:

- `backend`
- `frontend`

After the first successful launch, you can stop/start the app from Docker Desktop:

1. Open Docker Desktop.
2. Go to **Containers**.
3. Find `archeorag`.
4. Click the blue **Play** button next to `archeorag`.
5. Open `http://localhost:5173`.

If `archeorag` does not appear in Docker Desktop yet, run the PowerShell command from step 2 once first.

## 4. Add your API key

In the app:

1. Open **Paramètres**.
2. Paste your OpenAI API key.
3. Save.

You can also add Google or Perplexity keys there later if needed. You do not need to edit `.env` manually for normal testing.

The app uses paid model API calls. Indexing, Matrix builds, Compare cite, and Chat can cost money depending on usage.

## 5. Basic test flow

1. Add a few PDF papers in the app.
2. Run indexing.
3. Ask a cited question in Chat.
4. Build or inspect the Matrix.
5. Try Similarities, Differences, or Contradictions.
6. Use Compare cite when a workflow says a candidate tension needs citation validation.

The first indexing run can be slow. GPU mode should be faster if CUDA is working.

## 6. Check whether GPU mode works

If you started with the GPU command, open a second PowerShell window and run:

```powershell
cd C:\Users\Wail\Desktop\archeorag
docker compose -f docker-compose.yml -f docker-compose.gpu.yml exec backend python -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"
```

Good result:

```text
True
NVIDIA GeForce RTX ...
```

If it prints `False` or `CPU`, use CPU mode or ask for help.

## 7. Stop and restart

To stop from PowerShell, press `Ctrl+C`.

To stop and remove the running containers:

```powershell
cd C:\Users\Wail\Desktop\archeorag
docker compose down
```

To restart CPU mode from PowerShell:

```powershell
cd C:\Users\Wail\Desktop\archeorag
docker compose up
```

To restart GPU mode from PowerShell:

```powershell
cd C:\Users\Wail\Desktop\archeorag
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up
```

Or restart from Docker Desktop by clicking **Play** next to `archeorag` in **Containers**.

Your PDFs, indexes, settings, and Matrix files stay on your machine in:

```text
archeoqa/data
```

## 8. Logs for debugging

Backend logs:

```powershell
cd C:\Users\Wail\Desktop\archeorag
docker compose logs backend --tail=200
```

Frontend logs:

```powershell
cd C:\Users\Wail\Desktop\archeorag
docker compose logs frontend --tail=200
```

For GPU mode logs, use the same extra compose file:

```powershell
cd C:\Users\Wail\Desktop\archeorag
docker compose -f docker-compose.yml -f docker-compose.gpu.yml logs backend --tail=200
```

## 9. Privacy notes

- PDFs are stored locally in `archeoqa/data`.
- Retrieved text snippets and questions can be sent to the configured model providers.
- Evidence Matrix builds and Compare cite calls can send multiple model requests.
- Do not share your `archeoqa/.env` file if it exists. It contains your API key.

## 10. If you get stuck

If Docker, PowerShell, or CUDA gets confusing, ask Codex or Claude Code to run the project for you.

Useful prompt:

```text
I have an ArcheoQA repository at C:\Users\Wail\Desktop\archeorag. Please start it with Docker. If I have an NVIDIA RTX GPU, try the GPU compose command first; otherwise use CPU mode. Then tell me the localhost URL.
```
