FROM python:3.12-slim

WORKDIR app

COPY apprequirements.txt apprequirements.txt

RUN pip install --no-cache-dir -r apprequirements.txt

COPY app app
COPY run.sh run.sh

RUN chmod +x run.sh

EXPOSE 8090

CMD [run.sh]
