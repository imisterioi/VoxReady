FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Dentro del contenedor hay que escuchar en 0.0.0.0 para que el puerto publicado
# sea alcanzable desde el host (Windows). El backend Node se conecta con WHISPER_URL.
ENV WHISPER_HOST=0.0.0.0
ENV WHISPER_PORT=8001

EXPOSE 8001

# Nota: transcribe.py era un stub que solo cargaba el modelo. El servicio real es server.py.
CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001"]
