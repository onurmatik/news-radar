from rest_framework import serializers


class SimilarContentRequestSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=500)
    date = serializers.DateField()
    threshold = serializers.FloatField(default=0.8, min_value=0.0, max_value=1.0)
    limit = serializers.IntegerField(default=10, min_value=1, max_value=100)
