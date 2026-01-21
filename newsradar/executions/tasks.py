from celery import shared_task

from newsradar.executions.services import execute_web_search


@shared_task(name="executions.web_search_execution")
def web_search_execution(
    topic_uuid: str,
    initiator: str = "user",
    execution_id: int | None = None,
) -> dict:
    return execute_web_search(
        topic_uuid,
        initiator=initiator,
        execution_id=execution_id,
    )
