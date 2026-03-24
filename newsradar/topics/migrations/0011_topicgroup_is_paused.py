from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("topics", "0010_alter_topic_additional_queries_mode_default"),
    ]

    operations = [
        migrations.AddField(
            model_name="topicgroup",
            name="is_paused",
            field=models.BooleanField(default=False),
        ),
    ]
